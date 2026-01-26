// =================== SERVICE DIFF ===================
class ServiceDiff {
	serviceArrtibute;

	constructor() {
		this.serviceArrtibute = new Set();
		/**
		 * Отслеживает номер VDOM для поддержки связи
		 */
		this.serviceArrtibute.add('mc_rnd_model_controlled');
	}

	checkServiceAttribute(name) {
		if (this.serviceArrtibute.has(name)) {
			return true;
		}
	}
}

/**
 * =======================================
 * Новый EventDiff, нужно тестировать
 * =======================================
 */
class EventDiff {
	normalize(map) {
		const out = {};
		const src = map || {};
		for (const ev in src) {
			const arr = Array.isArray(src[ev]) ? src[ev].filter(Boolean) : [];
			// дедуп по ссылке
			out[ev] = Array.from(new Set(arr));
		}
		return out;
	}

	diffEvents(oldNode, newNode, ctx) {
		const oldEvents = this.normalize(oldNode.__mcEvents);
		const newEvents = this.normalize(newNode.__mcEvents);

		const add = {};
		const remove = {};

		// remove = old - new
		for (const ev in oldEvents) {
			const oldArr = oldEvents[ev] || [];
			const newArr = newEvents[ev] || [];
			const newSet = new Set(newArr);

			const toRemove = oldArr.filter((fn) => !newSet.has(fn));
			if (toRemove.length) {
				remove[ev] = toRemove;
			}
		}

		// add = new - old
		for (const ev in newEvents) {
			const newArr = newEvents[ev] || [];
			const oldArr = oldEvents[ev] || [];
			const oldSet = new Set(oldArr);

			const toAdd = newArr.filter((fn) => !oldSet.has(fn));
			if (toAdd.length) {
				add[ev] = toAdd;
			}
		}

		// также нужно понимать, какие типы событий исчезли полностью
		const removedTypes = [];
		for (const ev in oldEvents) {
			if (!newEvents[ev] || newEvents[ev].length === 0) {
				removedTypes.push(ev);
			}
		}

		return { add, remove, removedTypes, nextSnapshot: newEvents, ctx };
	}

	applyEvents(patch, domNode) {
		if (!patch || !domNode) {
			return;
		}

		domNode.__mcBound = domNode.__mcBound || {};
		domNode.__mcEvents = domNode.__mcEvents || {};

		// 1) точечно снимаем обработчики
		for (const ev in patch.remove || {}) {
			const arr = patch.remove[ev] || [];
			for (let i = 0; i < arr.length; i++) {
				const fn = arr[i];
				try {
					$(domNode).unbind(ev, fn);
				} catch (e) {}
			}
		}

		// 2) если тип события пропал полностью — подчистим “хранилища”
		for (let i = 0; i < (patch.removedTypes || []).length; i++) {
			const ev = patch.removedTypes[i];
			delete domNode.__mcBound[ev];
			delete domNode.__mcEvents[ev];
		}

		// 3) добавляем недостающие
		for (const ev in patch.add || {}) {
			const arr = patch.add[ev] || [];
			for (let i = 0; i < arr.length; i++) {
				const fn = arr[i];
				try {
					$(domNode).on(ev, fn);
				} catch (e) {}
			}
		}

		// 4) синхронизируем “снимок” — важно, чтобы __mcEvents не рос бесконечно
		domNode.__mcEvents = patch.nextSnapshot || {};
		domNode.__mcBound = patch.nextSnapshot || {};
	}
}

class AttrDiff {
	/**
	 * Сервисные функции
	 */
	serviceDiff;

	/**
	 * Экземпляр МС
	 */
	mc;

	constructor(service, mc) {
		this.serviceDiff = service;
		this.mc = mc;
	}

	diffAttributes(oldNode, newNode, ctx) {
		const oldAttrs = oldNode.attributes ? Array.from(oldNode.attributes) : [];
		const newAttrs = newNode.attributes ? Array.from(newNode.attributes) : [];

		const set = {};
		const remove = [];

		// Стандартная логика по атрибутам (атрибуты как есть)
		for (const attr of newAttrs) {
			if (oldNode.getAttribute(attr.name) !== attr.value) {
				set[attr.name] = attr.value;
			}
		}
		for (const attr of oldAttrs) {
			if (!newNode.hasAttribute(attr.name)) {
				remove.push(attr.name);
			}
		}

		if (oldNode.nodeType === 1 && newNode.nodeType === 1) {
			const tag = (newNode.tagName || '').toLowerCase();

			for (const attr of oldAttrs) {
				// ✅ value у форм-элементов диффится отдельно через property value
				if ((tag === 'input' || tag === 'textarea' || tag === 'select') && attr.name === 'value') {
					continue;
				}

				if (!newNode.hasAttribute(attr.name)) {
					remove.push(attr.name);
				}
			}

			// value для input/textarea/select
			if (tag === 'input' || tag === 'textarea' || tag === 'select') {
				// сравниваем property value (текущее) с новой версией
				const oldVal = oldNode.value != null ? String(oldNode.value) : oldNode.getAttribute('value');
				const newVal = newNode.value != null ? String(newNode.value) : newNode.getAttribute('value');
				if (oldVal !== newVal) {
					set['value'] = newVal == null ? '' : newVal;
				}
			}

			// checked для checkbox/radio — ставим/удаляем реальный атрибут checked
			if (tag === 'input' && (newNode.type === 'checkbox' || newNode.type === 'radio')) {
				const oldChecked = !!oldNode.checked;
				const newChecked = !!newNode.checked;
				if (oldChecked !== newChecked) {
					if (newChecked) {
						set['checked'] = 'checked';
					} else {
						// поместим в remove — так как атрибут должен быть удалён
						remove.push('checked');
					}
				}
			}
		}

		return {
			set,
			remove,
			ctx,
		};
	}

	applyAttributes(attrPatch, domNode) {
		if (!attrPatch) return;

		// Применяем "set" (включая value/checked)
		for (const [attr, val] of Object.entries(attrPatch.set || {})) {
			if (attr === 'value') {
				// property + атрибут — чтобы и отображение, и атрибут были синхронизированы
				try {
					if ('value' in domNode) domNode.value = val;
				} catch (e) {
					/* ignore */
				}
				// setAttribute для совместимости/серриализации
				domNode.setAttribute('value', val);

				// Если это select — синхронизируем опции (selected атрибуты)
				if (domNode.tagName && domNode.tagName.toLowerCase() === 'select') {
					const desired = String(val);
					for (const opt of domNode.options || []) {
						const isSelected = opt.value === desired;
						opt.selected = isSelected;
						if (isSelected) opt.setAttribute('selected', 'selected');
						else opt.removeAttribute('selected');
					}
				}
				continue;
			}

			if (attr === 'checked') {
				// val будет 'checked' — выставим property и атрибут
				if ('checked' in domNode) domNode.checked = true;
				domNode.setAttribute('checked', 'checked');
				// для radio: при установке checked property браузер снимет checked с других в группе автоматически
				continue;
			}

			// Обычные атрибуты
			domNode.setAttribute(attr, val);
		}

		// Обработка удалений
		for (const attr of attrPatch.remove || []) {
			if (attr === 'checked') {
				if ('checked' in domNode) domNode.checked = false;
				domNode.removeAttribute('checked');
				continue;
			}
			if (attr === 'value') {
				// if ("value" in domNode) domNode.value = "";
				domNode.removeAttribute('value');
				// // для select — убрать selected у всех опций
				// if (domNode.tagName && domNode.tagName.toLowerCase() === "select") {
				//   for (const opt of domNode.options || []) {
				//     opt.selected = false;
				//     opt.removeAttribute("selected");
				//   }
				// }
				continue;
			}

			domNode.removeAttribute(attr);
		}
	}
}

// =================== STYLE DIFF ===================
class StyleDiff {
	diffStyles(oldNode, newNode, ctx) {
		// Обработка inline-стилей
		const oldStyle = (oldNode.getAttribute && oldNode.getAttribute('style')) || '';
		const newStyle = (newNode.getAttribute && newNode.getAttribute('style')) || '';
		if (oldStyle !== newStyle) {
			return { set: newStyle, ctx };
		}
		return { ctx };
	}

	applyStyles(stylePatch, domNode) {
		if (!stylePatch) return;
		if ('set' in stylePatch) {
			domNode.setAttribute('style', stylePatch.set);
		}
	}
}

// =================== CLASS DIFF ===================
class ClassDiff {
	diffClasses(oldNode, newNode, ctx) {
		// Обработка class атрибута (строка или список)
		const oldClass = (oldNode.getAttribute && oldNode.getAttribute('class')) || '';
		const newClass = (newNode.getAttribute && newNode.getAttribute('class')) || '';
		if (oldClass !== newClass) {
			return { set: newClass, ctx };
		}
		return { ctx };
	}

	applyClasses(classPatch, domNode) {
		if (!classPatch) return;
		if ('set' in classPatch) {
			domNode.setAttribute('class', classPatch.set);
		}
	}
}

class MasterDiff {
	/**
	 * Сравнение атрибутов
	 */
	attrDiff;
	/**
	 * Сравнение стилей
	 */
	styleDiff;
	/**
	 * Сравнение классов
	 */
	classDiff;

	/**
	 * Сервисные иньекции в DOM
	 */
	serviceDiff;

	/**
	 * MC
	 */
	mc;

	constructor(attrDiff, styleDiff, classDiff, eventDiff, mc) {
		this.attrDiff = attrDiff;
		this.styleDiff = styleDiff;
		this.classDiff = classDiff;
		this.eventDiff = eventDiff;
		this.mc = mc;
	}

	cleanupVDOM(oldNode, newNode) {
		// всегда работаем с корневым MC
		if (this.mc.constructor.name !== 'MC') {
			this.mc = this.mc.mc;
		}

		// --- FN контейнеры --------------------------------------------------------
		if (oldNode.instanceMCtype === 'fn') {
			const id = oldNode.instanceMC; // это id (instanceMC), не key
			const oldKey = this.mc.fcIdsCollection.get(id);

			// ✅ если узел больше не принадлежит этому fn (сменился/пропал) — форс-cleanup
			const fnRemoved =
				!newNode.instanceMC || newNode.instanceMCtype !== 'fn' || newNode.instanceMC !== oldNode.instanceMC;

			if (fnRemoved && oldKey) {
				// если ты добавил force в _cleanupFunctionContainerByKey — используй его
				// иначе можно оставить без force, но лучше сделать аналогично компонентам
				try {
					this.mc._cleanupFunctionContainerByKey(oldKey, true);
				} catch (e) {
					// fallback на старое поведение
					const vdom = this.mc.fcCollection.get(oldKey);
					if (vdom) vdom.HTML = null;
				}
			}

			// ✅ перенос метки на тот же DOM-узел
			if (newNode.instanceMCtype === 'fn' && newNode.instanceMC) {
				oldNode.instanceMC = newNode.instanceMC;
				oldNode.instanceMCtype = 'fn';
			} else {
				oldNode.instanceMC = undefined;
				oldNode.instanceMCtype = undefined;
			}

			return;
		}

		// --- Class компоненты -----------------------------------------------------
		if (oldNode.instanceMCtype === 'mc_component') {
			const id = oldNode.instanceMC; // это id (instanceMC), не key
			const oldKey = this.mc.componentIdsCollection.get(id);

			// ✅ если компонент исчез или сменился — нужно форсировать unmount
			const compRemoved =
				!newNode.instanceMC ||
				newNode.instanceMCtype !== 'mc_component' ||
				newNode.instanceMC !== oldNode.instanceMC;

			if (compRemoved && oldKey) {
				// ты уже поменял _cleanupComponentByKey — вызываем форсом
				this.mc._cleanupComponentByKey(oldKey, true);
			} else {
				// на всякий случай: старое поведение
				const vdom = oldKey ? this.mc.componentCollection.get(oldKey) : null;
				if (vdom) vdom.HTML = null;
			}

			// ✅ перенос метки на тот же DOM-узел
			if (newNode.instanceMCtype === 'mc_component' && newNode.instanceMC) {
				oldNode.instanceMC = newNode.instanceMC;
				oldNode.instanceMCtype = 'mc_component';
			} else {
				oldNode.instanceMC = undefined;
				oldNode.instanceMCtype = undefined;
			}

			return;
		}
	}

	/**
	 * Основная функция сравнения двух узлов
	 * Возвращает структуру патча ("trace"), содержащую необходимые операции для применения изменений.
	 */
	diffNode(oldNode, newNode, ctx) {
		const context = Object.assign({ level: 0, path: '' }, ctx);

		// === Базовые случаи: отсутствие узлов ===
		if (!oldNode && newNode) {
			return { type: 'ADD', node: newNode, ctx: context };
		}
		if (oldNode && !newNode) {
			return { type: 'REMOVE', ctx: context };
		}
		if (!oldNode && !newNode) {
			return { type: 'NONE', ctx: context };
		}

		if (oldNode.instanceMC && newNode.instanceMC && oldNode.instanceMC !== newNode.instanceMC) {
			this.cleanupVDOM(oldNode, newNode);
		}

		if (oldNode.instanceMC && !newNode.instanceMC) {
			this.cleanupVDOM(oldNode, newNode);
		}

		if (!oldNode.instanceMC && newNode.instanceMC) {
			oldNode.instanceMC = newNode.instanceMC;
			oldNode.instanceMCtype = newNode.instanceMCtype;
		}

		// === Типы узлов ===
		if (oldNode.nodeType !== newNode.nodeType) {
			return { type: 'REPLACE', node: newNode, ctx: context };
		}

		// === Текстовые узлы ===
		if (oldNode.nodeType === Node.TEXT_NODE) {
			if (oldNode.textContent !== newNode.textContent) {
				return { type: 'TEXT', text: newNode.textContent, ctx: context };
			}
			return { type: 'NONE', ctx: context };
		}

		// === Комментарии ===
		if (oldNode.nodeType === Node.COMMENT_NODE) {
			if (oldNode.textContent !== newNode.textContent) {
				return { type: 'COMMENT', text: newNode.textContent, ctx: context };
			}
			return { type: 'NONE', ctx: context };
		}

		// === DOCUMENT_FRAGMENT_NODE, DOCUMENT_NODE, DOCUMENT_TYPE_NODE ===
		if (
			oldNode.nodeType === Node.DOCUMENT_FRAGMENT_NODE ||
			oldNode.nodeType === Node.DOCUMENT_NODE ||
			oldNode.nodeType === Node.DOCUMENT_TYPE_NODE
		) {
			// Сравнение детей (кроме типа)
			return this.diffChildren(oldNode, newNode, context);
		}

		// === Элементные узлы ===
		if (oldNode.nodeType === Node.ELEMENT_NODE) {
			// Проверяем тэг
			if (oldNode.nodeName !== newNode.nodeName) {
				return { type: 'REPLACE', node: newNode, ctx: context };
			}

			if (newNode.__mc_ref_cb) {
				oldNode.__mc_ref_cb = newNode.__mc_ref_cb;
			} else if (oldNode.__mc_ref_cb) {
				delete oldNode.__mc_ref_cb;
			}

			if (newNode.__mc_ref_obj) {
				oldNode.__mc_ref_obj = newNode.__mc_ref_obj;
			} else if (oldNode.__mc_ref_obj) {
				delete oldNode.__mc_ref_obj;
			}

			// ✅ Переносим флаг host на реальный DOM (oldNode)
			if (newNode.__mc_host) {
				oldNode.__mc_host = true;
			} else if (oldNode.__mc_host) {
				delete oldNode.__mc_host;
			}

			// ✅ (если у тебя уже есть перенос ref — оставь, иначе добавь)
			if (newNode.__mc_ref_cb) {
				oldNode.__mc_ref_cb = newNode.__mc_ref_cb;
			} else if (oldNode.__mc_ref_cb) {
				delete oldNode.__mc_ref_cb;
			}

			if (newNode.__mc_ref_obj) {
				oldNode.__mc_ref_obj = newNode.__mc_ref_obj;
			} else if (oldNode.__mc_ref_obj) {
				delete oldNode.__mc_ref_obj;
			}

			// Сравнение атрибутов, стилей, классов, событий
			const attrPatch = this.attrDiff.diffAttributes(oldNode, newNode, context);
			const stylePatch = this.styleDiff.diffStyles(oldNode, newNode, context);
			const classPatch = this.classDiff.diffClasses(oldNode, newNode, context);
			const eventPatch = this.eventDiff.diffEvents(oldNode, newNode, context);

			if (oldNode.instanceMC && newNode.instanceMC) {
				if (oldNode.instanceMC !== newNode.instanceMC) {
					oldNode.instanceMC = newNode.instanceMC;
				}
			}

			// Дети
			const childrenPatch = oldNode.__mc_host
				? { type: 'NONE', ctx: context }
				: this.diffChildren(oldNode, newNode, context);

			return {
				type: 'UPDATE',
				attrPatch,
				stylePatch,
				classPatch,
				eventPatch,
				childrenPatch,
				ctx: context,
			};
		}

		// === Падение по умолчанию: нераспознанный случай ===
		return { type: 'REPLACE', node: newNode, ctx: context };
	}

	/**
	 * Рекурсивное сравнение детей узлов
	 */
	diffChildren(oldNode, newNode, ctx) {
		const context = Object.assign({}, ctx, { level: (ctx.level || 0) + 1 });
		const oldChildren = Array.from(oldNode.childNodes);
		const newChildren = Array.from(newNode.childNodes);
		const maxLen = Math.max(oldChildren.length, newChildren.length);
		const childPatches = [];

		for (let i = 0; i < maxLen; i++) {
			const path = context.path + '/' + i; // глубина
			childPatches.push(this.diffNode(oldChildren[i], newChildren[i], { ...context, path }));
		}
		return { type: 'CHILDREN', patches: childPatches, ctx: context };
	}
}

class PatchMaster {
	/**
	 * Сравнение атрибутов
	 */
	attrDiff;

	/**
	 * Сравнение стилей
	 */
	styleDiff;

	/**
	 * Сравнение классов
	 */
	classDiff;

	/**
	 * Сравнение событий
	 */
	eventDiff;

	/**
	 * Экземпляр MC
	 */
	mc;

	constructor(attrDiff, styleDiff, classDiff, eventDiff, mc) {
		this.attrDiff = attrDiff;
		this.styleDiff = styleDiff;
		this.classDiff = classDiff;
		this.eventDiff = eventDiff;
		this.mc = mc;
	}

	/**
	 * ✅ “mount-like” refs + корректный mount для компонентов после переподключения VDOM.
	 * Главное: ref-callback вызывается только:
	 *  - когда узел реально смонтирован (el.isConnected)
	 *  - один раз на жизнь DOM-узла, либо если поменялась функция ref-callback
	 * И ref-object выставляется аналогично.
	 */
	reconnectingVDOM(rootNode) {
		let rootMC = this.mc;
		if (rootMC && rootMC.constructor && rootMC.constructor.name !== 'MC') {
			rootMC = rootMC.mc;
		}

		// ✅ список кандидатов на mounted (в Set чтобы без дублей)
		const toMount = new Set();

		const processEl = (el) => {
			if (!el || el.nodeType !== 1) return;

			// ------------------------------------------------------------------
			// 1) ✅ REF mount-like
			// ------------------------------------------------------------------
			const isConnected = !!el.isConnected;

			// a) ref-callback
			const cb = typeof el.__mc_ref_cb === 'function' ? el.__mc_ref_cb : null;
			const lastCb = typeof el.__mc_ref_last_cb === 'function' ? el.__mc_ref_last_cb : null;

			// если ref сняли (раньше был, теперь нет) — detach один раз
			if (!cb && lastCb && el.__mc_ref_mounted) {
				try {
					lastCb(null);
				} catch (e) {
					console.error(e);
				}
				el.__mc_ref_mounted = false;
				el.__mc_ref_last_cb = null;
			}

			// если ref есть — вызвать только при mount и только один раз, либо если cb изменился
			if (cb && isConnected) {
				const changed = lastCb !== cb;
				const needCall = !el.__mc_ref_mounted || changed;

				if (needCall) {
					// если callback поменялся — корректно “снять” старый
					if (el.__mc_ref_mounted && lastCb && lastCb !== cb) {
						try {
							lastCb(null);
						} catch (e) {
							console.error(e);
						}
					}

					try {
						cb(el);
					} catch (e) {
						console.error(e);
					}

					el.__mc_ref_mounted = true;
					el.__mc_ref_last_cb = cb;
				}
			}

			// b) ref-object
			const obj = el.__mc_ref_obj && typeof el.__mc_ref_obj === 'object' ? el.__mc_ref_obj : null;
			const lastObj =
				el.__mc_ref_last_obj && typeof el.__mc_ref_last_obj === 'object'
					? el.__mc_ref_last_obj
					: null;

			if (!obj && lastObj && el.__mc_ref_obj_mounted) {
				try {
					lastObj.current = null;
				} catch (e) {
					console.error(e);
				}
				el.__mc_ref_obj_mounted = false;
				el.__mc_ref_last_obj = null;
			}

			if (obj && isConnected) {
				const changedObj = lastObj !== obj;
				const needSet = !el.__mc_ref_obj_mounted || changedObj;

				if (needSet) {
					// если объект поменялся — старый очистить
					if (el.__mc_ref_obj_mounted && lastObj && lastObj !== obj) {
						try {
							lastObj.current = null;
						} catch (e) {
							console.error(e);
						}
					}

					try {
						obj.current = el;
					} catch (e) {
						console.error(e);
					}

					el.__mc_ref_obj_mounted = true;
					el.__mc_ref_last_obj = obj;
				}
			}

			// ------------------------------------------------------------------
			// 2) instanceMC (fn / class component)
			// ------------------------------------------------------------------
			if (!el.instanceMC) return;

			if (el.instanceMCtype === 'fn') {
				const key = el.instanceMC;
				const vdom = rootMC.fcCollection.get(rootMC.fcIdsCollection.get(key));
				if (vdom) vdom.HTML = el;
				return;
			}

			if (el.instanceMCtype === 'mc_component') {
				const key = el.instanceMC;
				const vdom = rootMC.componentCollection.get(rootMC.componentIdsCollection.get(key));

				if (vdom) {
					vdom.HTML = el;

					// ✅ mounted НЕ здесь — только собираем
					if (el.isConnected && !vdom._mountedCalled) {
						toMount.add(vdom);
					}
				}
			}
		};

		// root
		if (
			rootNode &&
			rootNode.nodeType === 1 &&
			(
				rootNode.instanceMC ||
				rootNode.__mc_ref_cb ||
				rootNode.__mc_ref_obj ||
				rootNode.__mc_ref_last_cb ||
				rootNode.__mc_ref_last_obj
			)
		) {
			processEl(rootNode);
		}

		// walk subtree: принимаем и instanceMC и ref-ноды (включая “ref был, но сняли”)
		const walker = document.createTreeWalker(
			rootNode,
			NodeFilter.SHOW_ELEMENT,
			{
				acceptNode(node) {
					return node.instanceMC ||
						node.__mc_ref_cb ||
						node.__mc_ref_obj ||
						node.__mc_ref_last_cb ||
						node.__mc_ref_last_obj
						? NodeFilter.FILTER_ACCEPT
						: NodeFilter.FILTER_SKIP;
				},
			},
			false
		);

		let node = walker.nextNode();
		while (node) {
			processEl(node);
			node = walker.nextNode();
		}

		// ✅ mounted вызов отдельно, после reconnection
		toMount.forEach((vdom) => {
			if (!vdom || vdom._mountedCalled) return;
			if (!vdom.HTML || !vdom.HTML.isConnected) return;

			try {
				// (оставляю твою текущую сигнатуру вызова как есть)
				vdom.mounted.call(
					vdom.component,
					rootMC.engine.formationStates(vdom),
					vdom.normalized.props,
					vdom
				);
			} catch (e) {
				console.error('MC mounted error:', e);
			}

			vdom._mountedCalled = true;
		});
	}

	/**
	 * ✅ Ref detach для узла (как React: cb(null), obj.current=null),
	 * плюс сброс маркеров mount-like.
	 */
	_detachRefsOnEl(el) {
		if (!el || el.nodeType !== 1) return;

		// callback
		const lastCb = typeof el.__mc_ref_last_cb === 'function' ? el.__mc_ref_last_cb : null;
		const cb = typeof el.__mc_ref_cb === 'function' ? el.__mc_ref_cb : null;

		// вызываем null только если ранее реально “монтировали”
		if (el.__mc_ref_mounted) {
			const fn = lastCb || cb;
			if (typeof fn === 'function') {
				try {
					fn(null);
				} catch (e) {
					console.error(e);
				}
			}
		}

		// object
		const lastObj =
			el.__mc_ref_last_obj && typeof el.__mc_ref_last_obj === 'object'
				? el.__mc_ref_last_obj
				: null;
		const obj = el.__mc_ref_obj && typeof el.__mc_ref_obj === 'object' ? el.__mc_ref_obj : null;

		if (el.__mc_ref_obj_mounted) {
			const target = lastObj || obj;
			try {
				if (target) target.current = null;
			} catch (e) {
				console.error(e);
			}
		}

		// сброс маркеров, чтобы узел не “помнил” прошлую жизнь
		el.__mc_ref_mounted = false;
		el.__mc_ref_obj_mounted = false;
		el.__mc_ref_last_cb = null;
		el.__mc_ref_last_obj = null;
	}

	/**
	 * ✅ Ref detach по всему поддереву.
	 * Важно вызывать перед REMOVE/REPLACE, потому что observer может быть подавлен.
	 */
	_detachRefsDeep(root) {
		if (!root) return;

		// если корень элемент — обработать
		if (root.nodeType === 1) {
			this._detachRefsOnEl(root);
		}

		// пройти детей-элементов, где вообще есть ref / last_ref
		const walker = document.createTreeWalker(
			root,
			NodeFilter.SHOW_ELEMENT,
			{
				acceptNode(node) {
					return node.__mc_ref_cb ||
						node.__mc_ref_obj ||
						node.__mc_ref_last_cb ||
						node.__mc_ref_last_obj
						? NodeFilter.FILTER_ACCEPT
						: NodeFilter.FILTER_SKIP;
				},
			},
			false
		);

		let n = walker.nextNode();
		while (n) {
			this._detachRefsOnEl(n);
			n = walker.nextNode();
		}
	}

	/**
	 * Применяет патч к DOM-узлу.
	 * ✅ В REMOVE/REPLACE (+ replace в TEXT/COMMENT) делаем ref-detach перед физическим удалением.
	 */
	applyPatch(patch, domNode, ctx) {
		if (!patch) {
			return domNode;
		}

		const context = Object.assign({ level: 0, path: '' }, ctx);

		switch (patch.type) {
			case 'ADD':
				if (domNode && domNode.parentNode) {
					domNode.parentNode.appendChild(patch.node);
				}
				return patch.node;

			case 'REMOVE':
				if (domNode) {
					// ✅ detach refs before removal
					this._detachRefsDeep(domNode);

					if (domNode.parentNode) {
						domNode.parentNode.removeChild(domNode);
					}
				}
				return null;

			case 'REPLACE':
				if (domNode) {
					// ✅ detach refs before replace
					this._detachRefsDeep(domNode);

					if (domNode.parentNode) {
						domNode.parentNode.replaceChild(patch.node, domNode);
						return patch.node;
					}
				}
				return patch.node;

			case 'TEXT': {
				if (domNode && domNode.nodeType === Node.TEXT_NODE) {
					domNode.textContent = patch.text;
					return domNode;
				}

				// domNode заменяем — значит старый узел уходит => detach refs
				if (domNode) {
					this._detachRefsDeep(domNode);
				}

				if (domNode && domNode.parentNode) {
					const textNode = document.createTextNode(patch.text);
					domNode.parentNode.replaceChild(textNode, domNode);
					return textNode;
				}

				return document.createTextNode(patch.text);
			}

			case 'COMMENT': {
				if (domNode && domNode.nodeType === Node.COMMENT_NODE) {
					domNode.nodeValue = patch.text;
					return domNode;
				}

				// domNode заменяем — значит старый узел уходит => detach refs
				if (domNode) {
					this._detachRefsDeep(domNode);
				}

				if (domNode && domNode.parentNode) {
					const comment = document.createComment(patch.text);
					domNode.parentNode.replaceChild(comment, domNode);
					return comment;
				}

				return document.createComment(patch.text);
			}

			case 'UPDATE':
				// Атрибуты
				this.attrDiff.applyAttributes(patch.attrPatch, domNode);
				// Стили
				this.styleDiff.applyStyles(patch.stylePatch, domNode);
				// Классы
				this.classDiff.applyClasses(patch.classPatch, domNode);
				// События
				this.eventDiff.applyEvents(patch.eventPatch, domNode);
				// Дети
				this.applyPatch(patch.childrenPatch, domNode, context);
				return domNode;

			case 'CHILDREN':
				this._applyChildren(patch.patches, domNode, context);
				return domNode;

			case 'NONE':
				return domNode;

			default:
				return domNode;
		}
	}

	/**
	 * Rекурсивное применение патчей к детям.
	 * ✅ При REMOVE ребёнка делаем ref-detach перед removeChild.
	 */
	_applyChildren(childPatches, domNode, ctx) {
		for (let i = 0; i < childPatches.length; i++) {
			const patch = childPatches[i];
			const child = domNode.childNodes[i];

			// ADD: append
			if (!child && patch && patch.type === 'ADD') {
				domNode.appendChild(patch.node);
				continue;
			}

			// REMOVE
			if (child && patch && patch.type === 'REMOVE') {
				// ✅ detach refs before removal
				this._detachRefsDeep(child);

				// при удалении ребёнка из DOM он сместится. Без отката пропустит обработку
				--i;
				domNode.removeChild(child);
				continue;
			}

			// EMPTY SKIP
			if (!child && patch) continue;

			// RECURSIVE
			if (child && patch) {
				this.applyPatch(patch, child, ctx);
			}
		}

		// Если новые дети длиннее старых — добавить недостающих
		for (let i = domNode.childNodes.length; i < childPatches.length; i++) {
			const patch = childPatches[i];
			if (patch && patch.type === 'ADD') {
				domNode.appendChild(patch.node);
			}
		}
	}
}

class MCDiff {
	/**
	 * Детально проверит разницу между двумя узлами DOM
	 */
	master;
	/**
	 * Применение изменений узлов
	 */
	patch;

	constructor(mc) {
		const serviceDiff = new ServiceDiff();
		const attrDiff = new AttrDiff(serviceDiff, mc);
		const styleDiff = new StyleDiff(serviceDiff);
		const classDiff = new ClassDiff(serviceDiff);
		const eventDiff = new EventDiff();

		this.master = new MasterDiff(attrDiff, styleDiff, classDiff, eventDiff, mc);
		this.patch = new PatchMaster(attrDiff, styleDiff, classDiff, eventDiff, mc);
	}

	start(oldNode, newNode) {
		const mc = this.patch.mc.constructor.name === 'MC' ? this.patch.mc : this.patch.mc.mc;

		try {
			mc._domObserverSuppress++;

			const trace = this.master.diffNode(oldNode, newNode, { level: 0, path: '' });
			const node = this.patch.applyPatch(trace, oldNode, { level: 0, path: '' });

			if (node) {
				this.patch.reconnectingVDOM(node);
			}

			return node;
		} finally {
			mc._domObserverSuppress--;
		}
	}
}