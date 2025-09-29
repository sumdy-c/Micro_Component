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

// TODO [MCv8]: Переработка событийной модели
//
// Цель: создать высокооптимизированную и надежную систему управления событиями для MCv8,
// устраняющую текущие ограничения:
//   1. Потеря ссылок на обработчики при ререндере и невозможность корректного removeEventListener.
//   2. Ненадежная дифференциация старых и новых обработчиков.
//   3. Избыточное использование jQuery для unbind/on, влияющее на производительность и размер бандла.
//   4. Нет прозрачной поддержки делегирования и контекста событий.
// =====
//   - Разработать внутреннюю структуру хранения обработчиков, которая сохраняет точные ссылки
//     и контексты, чтобы removeEventListener всегда работал.
//   - Обеспечить корректное сравнение старых и новых событий при дифференциации (diff).
//   - Добавить поддержку делегирования событий для минимизации количества слушателей.
//   - Обеспечить минимальный overhead при массовом ререндере большого количества узлов.
class EventDiff {
	diffEvents(oldNode, newNode, ctx) {
		const oldEvents = oldNode.__mcEvents || {};
		const newEvents = newNode.__mcEvents || {};

		const set = {};
		const remove = [];

		for (const ev in newEvents) {
			set[ev] = newEvents[ev];
		}
		for (const ev in oldEvents) {
			remove.push(ev);
		}

		return { set, remove, ctx };
	}

	applyEvents(patch, domNode) {
		if (!patch) {
			return;
		}
		domNode.__mcBound = domNode.__mcBound || {};

		(patch.remove || []).forEach((ev) => {
			if (domNode.__mcBound[ev]) {
				domNode.__mcBound[ev].forEach((fn) => {
					$(domNode).unbind(ev);
				});

				delete domNode.__mcBound[ev];
			}
		});

		// навесить новые
		for (const [ev, fnArr] of Object.entries(patch.set || {})) {
			if (fnArr && fnArr.length) {
				for (let fn of fnArr) {
					$(domNode).on(ev, fn);

					domNode.__mcBound[ev] = domNode.__mcBound[ev] || [];
					domNode.__mcBound[ev].push(fn);
				}
			}
		}
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

		/**
		 * @deprecated ранее искал атрибуты для восстановления связей
		 * const newAttrs = newNode.attributes ?
		 * Array.from(newNode.attributes).filter((item) => !this.serviceDiff.checkServiceAttribute(item.name)) : [];
		 */
		const set = {};
		const remove = [];
		// const service = {};

		// Новый/изменённый
		for (const attr of newAttrs) {
			if (oldNode.getAttribute(attr.name) !== attr.value) {
				set[attr.name] = attr.value;
			}
		}
		// Удалённый
		for (const attr of oldAttrs) {
			if (!newNode.hasAttribute(attr.name)) {
				remove.push(attr.name);
			}
		}

		return {
			set,
			remove,
			// service,
			ctx,
		};
	}

	applyAttributes(attrPatch, domNode) {
		if (!attrPatch) {
			return;
		}

		for (const [attr, val] of Object.entries(attrPatch.set || {})) {
			domNode.setAttribute(attr, val);
		}

		for (const attr of attrPatch.remove || []) {
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

	constructor(attrDiff, styleDiff, classDiff, eventDiff) {
		this.attrDiff = attrDiff;
		this.styleDiff = styleDiff;
		this.classDiff = classDiff;
		this.eventDiff = eventDiff;
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
			// а если у тебя <mc> пустой тэг ссылка - оно надо ?
			return { type: 'REMOVE', ctx: context };
		}
		if (!oldNode && !newNode) {
			return { type: 'NONE', ctx: context };
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

			// Сравнение атрибутов, стилей, классов, событий
			const attrPatch = this.attrDiff.diffAttributes(oldNode, newNode, context);
			const stylePatch = this.styleDiff.diffStyles(oldNode, newNode, context);
			const classPatch = this.classDiff.diffClasses(oldNode, newNode, context);
			const eventPatch = this.eventDiff.diffEvents(oldNode, newNode, context);

			if(oldNode.instanceMC && newNode.instanceMC) {
				if(oldNode.instanceMC !== newNode.instanceMC) {
					oldNode.instanceMC = newNode.instanceMC;
				}
			}

			// Дети
			const childrenPatch = this.diffChildren(oldNode, newNode, context);

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
	 * Сервисные иньекции в DOM
	 */
	serviceDiff;

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

	reconnectingVDOM(rootNode) {
		const processEl = (el) => {
			if (!el.instanceMC) {
				return;
			}

			if (el.instanceMCtype === 'fn') {
				const key = el.instanceMC;
				const vdom = this.mc.fcCollection.get(this.mc.fcIdsCollection.get(key));

				if (vdom) {
					vdom.HTML = el;
				}
			}

			if (el.instanceMCtype === 'mc_component') {
				const key = el.instanceMC;

				if (this.mc.constructor.name !== 'MC') {
					this.mc = this.mc.mc;
				}

				const vdom = this.mc.componentCollection.get(this.mc.componentIdsCollection.get(key));

				if (vdom) {
					vdom.HTML = el;
				}
			}
		};

		if (rootNode.nodeType === 1 && rootNode.instanceMC) {
			processEl(rootNode);
		}

		const walker = document.createTreeWalker(
			rootNode,
			NodeFilter.SHOW_ELEMENT,
			{
				acceptNode(node) {
					return node.instanceMC ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_SKIP;
				},
			},
			false
		);

		let node = walker.nextNode();
		while (node) {
			processEl(node);
			node = walker.nextNode();
		}
	}

	/**
	 * Применяет патч к DOM-узлу.
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
				if (domNode && domNode.parentNode) {
					domNode.parentNode.removeChild(domNode);
					this.reconnectingVDOM(patch.node);
				}
				return null;
			case 'REPLACE':
				if (domNode && domNode.parentNode) {
					domNode.parentNode.replaceChild(patch.node, domNode);
					this.reconnectingVDOM(patch.node);
					return patch.node;
				}
				return patch.node;
			case 'TEXT': {
				// Если текущий узел — текстовый, просто обновляем его содержимое:
				if (domNode && domNode.nodeType === Node.TEXT_NODE) {
					domNode.textContent = patch.text;
					return domNode;
				}

				// Если текущий узел есть, но не текстовый — заменяем его текстовым узлом
				if (domNode && domNode.parentNode) {
					const textNode = document.createTextNode(patch.text);
					domNode.parentNode.replaceChild(textNode, patch.node);
					return textNode;
				}

				// Нет текущего узла — создаём и возвращаем новый текстовый узел
				return document.createTextNode(patch.text);
			}
			case 'COMMENT': {
				if (domNode && domNode.nodeType === Node.COMMENT_NODE) {
					domNode.nodeValue = patch.text;
					return domNode;
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
				this.reconnectingVDOM(domNode);
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
	 */
	_applyChildren(childPatches, domNode, ctx) {
		for (let i = 0; i < childPatches.length; i++) {
			const patch = childPatches[i];
			const child = domNode.childNodes[i];
			// ADD: append
			if (!child && patch && patch.type === 'ADD') {
				this.reconnectingVDOM(patch.node);
				domNode.appendChild(patch.node);
				continue;
			}

			// REMOVE
			if (child && patch && patch.type === 'REMOVE') {
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
				this.reconnectingVDOM(child);
			}
		}
		// Если новые дети длиннее старых — добавить недостающих
		for (let i = domNode.childNodes.length; i < childPatches.length; i++) {
			const patch = childPatches[i];
			if (patch && patch.type === 'ADD') {
				this.reconnectingVDOM(patch.node);
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

	/**
	 * desc
	 */
	mc;

	constructor(mc) {
		const serviceDiff = new ServiceDiff();
		const attrDiff = new AttrDiff(serviceDiff, mc);
		const styleDiff = new StyleDiff(serviceDiff);
		const classDiff = new ClassDiff(serviceDiff);
		const eventDiff = new EventDiff();

		this.master = new MasterDiff(attrDiff, styleDiff, classDiff, eventDiff);
		this.patch = new PatchMaster(attrDiff, styleDiff, classDiff, eventDiff, mc);
		this.mc = mc;
	}

	reconnectingVDOM(rootNode) {
		const processEl = (el) => {
			if (!el.instanceMC) {
				return;
			}

			if (el.instanceMCtype === 'fn') {
				const key = el.instanceMC;
				const vdom = this.mc.fcCollection.get(this.mc.fcIdsCollection.get(key));

				if (vdom) {
					vdom.HTML = el;
				}
			}

			if (el.instanceMCtype === 'mc_component') {
				const key = el.instanceMC;

				if (this.mc.constructor.name !== 'MC') {
					this.mc = this.mc.mc;
				}

				const vdom = this.mc.componentCollection.get(this.mc.componentIdsCollection.get(key));

				if (vdom) {
					vdom.HTML = el;
				}
			}
		};

		if (rootNode.nodeType === 1 && rootNode.instanceMC) {
			processEl(rootNode);
		}

		const walker = document.createTreeWalker(
			rootNode,
			NodeFilter.SHOW_ELEMENT,
			{
				acceptNode(node) {
					return node.instanceMC ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_SKIP;
				},
			},
			false
		);

		let node = walker.nextNode();
		while (node) {
			processEl(node);
			node = walker.nextNode();
		}
	}

	start(oldNode, newNode) {
		try {
			const trace = this.master.diffNode(oldNode, newNode, { level: 0, path: '' });
			const node = this.patch.applyPatch(trace, oldNode, { level: 0, path: '' });

			if (globalThis.logOn) {
				console.log(node);
			}

			return node;
		} catch (e) {
			throw e;
		}
	}
}