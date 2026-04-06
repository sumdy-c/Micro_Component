/// <reference path="./types/mc.d.ts" />

// MCv8.1 — auto-init, comprehensive logging, re-flush protection
const _mc_instance_restore_object = { instance: null };

function _getRoot() {
	return _mc_instance_restore_object.instance;
}

// =================== STATE ===================

class MCState {
	/**
	 * id состояния
	 */
	id;

	/**
	 * Значение состояния
	 */
	value;

	/**
	 * Ключ доступа к состоянию
	 */
	traceKey;

	/**
	 * Коллекция закреплённых элементов (components)
	 */
	virtualCollection;

	/**
	 * Коллекция функциональных контейнеров
	 */
	fcCollection;

	/**
	 * Коллекция эффектов
	 */
	effectCollection;

	/**
	 * Состояние зарегистрировано и готово к обновлениям
	 */
	_registered;

	/**
	 * Если состояние локальное, хранит ссылку на компонент
	 */
	local;

	/**
	 * @deprecated Обозначение гостевого состояния
	 */
	guestState;

	/**
	 * Свойство неверной привязки состояния
	 */
	incorrectStateBindError;

	/**
	 * Внутренние оптимизации
	 */
	_version = 0;
	_identityHash = null;

	/* Статические приватные инструменты для хеширования/идентификации */
	static _objIdMap = new WeakMap();
	static _nextObjId = 1;

	/**
	 * Имя свойства для объекта получения
	 */
	nameProp;

	/**
	 * @param {Object} stateParam
	 * @param {*} local
	 */
	constructor(stateParam, local) {
		if (local) {
			this.local = local;
		}

		const { value, traceKey, id } = stateParam;
		this.value = value;
		this.guestState = false;
		this.incorrectStateBindError = false;
		this.traceKey = traceKey;
		this.id = id;
		this.virtualCollection = new Set();
		this.fcCollection = new Set();
		this.effectCollection = new Set();
		this.nameProp = null;
		this._registered = false;

		this._identityHash = MCState.computeShallowIdentity(value);
		this._version = 1;
	}

	/**
	 * Устанавливает новое значение состояния.
	 * Батчинг через queueMicrotask — все синхронные set() в одном тике
	 * обрабатываются единым flush.
	 * @param {*} newValue
	 */
	set(newValue) {
		// 1) Быстрые проверки
		if (newValue === this.value) {
			return;
		}

		// Примитивы: если оба примитива и !== — они различаются, продолжаем
		const typeA = typeof this.value;
		const typeB = typeof newValue;

		if (
			(this.value === null || typeA !== 'object') &&
			(newValue === null || typeB !== 'object')
		) {
			// оба примитива/null и !== -> различаются, продолжим к назначению
		} else {
			// Оба — объекты/массивы — пробуем быстрый shallow-скан
			let fastEqual = false;

			if (Array.isArray(this.value) && Array.isArray(newValue)) {
				if (this.value.length === newValue.length) {
					let sameRefElements = true;
					for (let i = 0; i < this.value.length; i++) {
						if (this.value[i] !== newValue[i]) {
							sameRefElements = false;
							break;
						}
					}
					if (sameRefElements) fastEqual = true;
				}
				// для очень больших массивов — identity с выборкой из середины
				if (!fastEqual && newValue.length > 500) {
					const hNew = MCState.computeShallowIdentity(newValue);
					if (hNew === this._identityHash) fastEqual = true;
				}
			} else if (!Array.isArray(this.value) && !Array.isArray(newValue)) {
				const keysA =
					this.value && typeof this.value === 'object'
						? Object.keys(this.value)
						: [];
				const keysB =
					newValue && typeof newValue === 'object'
						? Object.keys(newValue)
						: [];
				if (keysA.length === keysB.length) {
					let keysSame = true;
					for (let i = 0; i < keysA.length; i++) {
						const k = keysA[i];
						if (
							!Object.prototype.hasOwnProperty.call(newValue, k) ||
							this.value[k] !== newValue[k]
						) {
							keysSame = false;
							break;
						}
					}
					if (keysSame) fastEqual = true;
				}
				if (!fastEqual && keysA.length > 200) {
					const hNew = MCState.computeShallowIdentity(newValue);
					if (hNew === this._identityHash) fastEqual = true;
				}
			}

			if (fastEqual) {
				return;
			}
		}

		// 2) Глубокое сравнение (fallback)
		if (MCState.deepEqual(newValue, this.value)) {
			return;
		}

		// 3) Применяем новое значение и планируем flush
		if (this._registered) {
			this.value = newValue;
			this._identityHash = MCState.computeShallowIdentity(newValue);
			this._version++;

			const root = _getRoot();
			if (!root) return;

			// Предупреждение: set() напрямую в теле render (не из effect/lifecycle).
			if (root._userRenderDepth > 0 && !root._isInEffectCallback && !root._isInLifecycleCallback && MC.debugMode) {
				root.log.warn('state.set() вызван напрямую в render()', [
					`State: ${this.traceKey || this.nameProp || this.id}`,
					'Вызов set() напрямую в теле render() (не из effect) приведёт к бесконечному циклу.',
					'Перенесите set() в $.MC.effect() или в обработчик событий.',
				]);
			}

			root.listPendingRedrawRequests.delete(this.id);
			root.listPendingRedrawRequests.add(this.id);

			root._scheduleFlush();
		} else {
			const root = _getRoot();
			if (root) {
				root.log.warn('state.set() на незарегистрированном состоянии', [
					`State: ${this.traceKey || this.nameProp || this.id}`,
					'Состояние не зарегистрировано. Возможно оно ещё не инициализировано',
					'или компонент-владелец был удалён.',
				]);
			}
		}
	}

	/**
	 * Возвращает глубокую копию значения состояния.
	 * Безопасно для мутации снаружи.
	 */
	get() {
		return MCState.deepClone(this.value);
	}

	/**
	 * Возвращает значение БЕЗ копирования.
	 * Быстрее get(), но НЕЛЬЗЯ мутировать результат!
	 * Используйте для чтения внутри render/effect, где мутация не нужна.
	 */
	peek() {
		return this.value;
	}

	// =================== SHALLOW IDENTITY ===================

	/**
	 * Вычисляет лёгкий идентификатор/shallow-хеш для значения.
	 * Для массивов >16 элементов делает выборку из начала, середины и конца.
	 */
	static computeShallowIdentity(value) {
		if (value === null) return 'null';
		const t = typeof value;
		if (t !== 'object') return `p:${t}:${String(value)}`;

		if (value instanceof Date) return `D:${value.getTime()}`;
		if (value instanceof RegExp) return `R:${value.source}:${value.flags}`;

		if (Array.isArray(value)) {
			const len = value.length;
			const TAKE = 8;
			const parts = [`A:${len}`];

			const head = Math.min(TAKE, len);
			for (let i = 0; i < head; i++) {
				parts.push(MCState._tokenForShallow(value[i]));
			}

			if (len > TAKE * 2) {
				// Выборка из середины — закрывает «слепое пятно»
				const mid = len >>> 1;
				const midTake = Math.min(4, len >>> 2);
				parts.push('~');
				for (
					let i = Math.max(head, mid - midTake);
					i < Math.min(len - TAKE, mid + midTake);
					i++
				) {
					parts.push(MCState._tokenForShallow(value[i]));
				}

				parts.push('..');
				for (let i = len - TAKE; i < len; i++) {
					parts.push(MCState._tokenForShallow(value[i]));
				}
			} else {
				for (let i = head; i < len; i++) {
					parts.push(MCState._tokenForShallow(value[i]));
				}
			}

			return parts.join('|');
		}

		// Map
		if (value instanceof Map) {
			const parts = [`M:${value.size}`];
			let i = 0;
			for (const [k, v] of value) {
				parts.push(
					`${MCState._tokenForShallow(k)}=>${MCState._tokenForShallow(v)}`
				);
				if (++i >= 8) break;
			}
			return parts.join('|');
		}

		// Set
		if (value instanceof Set) {
			const parts = [`S:${value.size}`];
			let i = 0;
			for (const it of value) {
				parts.push(MCState._tokenForShallow(it));
				if (++i >= 8) break;
			}
			return parts.join('|');
		}

		// Plain object
		const keys = Object.keys(value);
		const len = keys.length;
		const TAKE_KEYS = 12;
		const parts = [`O:${len}`];
		const slice = keys.slice(0, TAKE_KEYS);
		for (const k of slice) {
			parts.push(`${k}=${MCState._tokenForShallow(value[k])}`);
		}
		if (len > TAKE_KEYS) parts.push('..');
		return parts.join('|');
	}

	static _tokenForShallow(v) {
		if (v === null) return 'null';
		const t = typeof v;
		if (t === 'object') {
			return `obj#${MCState._getObjectId(v)}`;
		}
		return `${t}:${String(v)}`;
	}

	static _getObjectId(obj) {
		if (obj === null || typeof obj !== 'object') return 0;
		let id = MCState._objIdMap.get(obj);
		if (!id) {
			id = MCState._nextObjId++;
			MCState._objIdMap.set(obj, id);
		}
		return id;
	}

	// =================== DEEP EQUAL ===================

	/**
	 * Рекурсивная функция глубокого сравнения.
	 * Set сравнивается по ссылкам (корректная семантика), не O(n²).
	 */
	static deepEqual(a, b) {
		if (a === b) return true;
		if (
			typeof a !== 'object' ||
			a === null ||
			typeof b !== 'object' ||
			b === null
		) {
			return false;
		}

		if (a instanceof Date && b instanceof Date) {
			return a.getTime() === b.getTime();
		}
		if (a instanceof RegExp && b instanceof RegExp) {
			return a.source === b.source && a.flags === b.flags;
		}

		// Map
		if (a instanceof Map && b instanceof Map) {
			if (a.size !== b.size) return false;
			for (const [k, v] of a) {
				if (!b.has(k) || !MCState.deepEqual(v, b.get(k))) return false;
			}
			return true;
		}

		// Set — сравнение по ссылкам (O(n), корректная семантика Set)
		if (a instanceof Set && b instanceof Set) {
			if (a.size !== b.size) return false;
			for (const item of a) {
				if (!b.has(item)) return false;
			}
			return true;
		}

		const seen = new WeakMap();
		function eq(x, y) {
			if (x === y) return true;
			if (
				typeof x !== 'object' ||
				x === null ||
				typeof y !== 'object' ||
				y === null
			) {
				return false;
			}

			if (x instanceof Date && y instanceof Date) {
				return x.getTime() === y.getTime();
			}
			if (x instanceof RegExp && y instanceof RegExp) {
				return x.source === y.source && y.flags === x.flags;
			}

			if (seen.has(x)) return seen.get(x) === y;
			seen.set(x, y);

			const isArrX = Array.isArray(x);
			const isArrY = Array.isArray(y);
			if (isArrX !== isArrY) return false;

			if (isArrX) {
				if (x.length !== y.length) return false;
				for (let i = 0; i < x.length; i++) {
					if (!eq(x[i], y[i])) return false;
				}
				return true;
			}

			const keysX = Object.keys(x);
			const keysY = Object.keys(y);
			if (keysX.length !== keysY.length) return false;

			for (let i = 0; i < keysX.length; i++) {
				const k = keysX[i];
				if (
					!Object.prototype.hasOwnProperty.call(y, k) ||
					!eq(x[k], y[k])
				) {
					return false;
				}
			}
			return true;
		}

		return eq(a, b);
	}

	// =================== DEEP CLONE ===================

	static deepClone(value) {
		if (typeof structuredClone === 'function') {
			try {
				return structuredClone(value);
			} catch (_e) {
				// fallthrough
			}
		}

		const seen = new WeakMap();
		function clone(v) {
			if (v === null || typeof v !== 'object') return v;
			if (seen.has(v)) return seen.get(v);

			if (v instanceof Date) {
				const d = new Date(v.getTime());
				seen.set(v, d);
				return d;
			}
			if (v instanceof RegExp) {
				const r = new RegExp(v.source, v.flags);
				seen.set(v, r);
				return r;
			}
			if (Array.isArray(v)) {
				const arr = [];
				seen.set(v, arr);
				for (let i = 0; i < v.length; i++) arr[i] = clone(v[i]);
				return arr;
			}
			if (v instanceof Map) {
				const m = new Map();
				seen.set(v, m);
				for (const [k, val] of v) m.set(clone(k), clone(val));
				return m;
			}
			if (v instanceof Set) {
				const s = new Set();
				seen.set(v, s);
				for (const it of v) s.add(clone(it));
				return s;
			}

			const out = {};
			seen.set(v, out);
			const keys = Object.keys(v);
			for (let i = 0; i < keys.length; i++) {
				out[keys[i]] = clone(v[keys[i]]);
			}
			return out;
		}

		return clone(value);
	}
}

// =================== LOG ===================

/**
 * Система логирования MC.
 * Уровни: error, warn, info, debug.
 *
 * MC.debugMode = true  — показывает все уровни (включая debug/info)
 * MC.debugMode = false — показывает только error и warn (по умолчанию)
 */
class MCLog {
	component;

	constructor(component) {
		if (!component) {
			console.error('[MC] Ошибка инициализации логирования для ресурсов MC.');
			return;
		}
		this.component = component;
	}

	/**
	 * Получить имя компонента для префикса
	 */
	_prefix() {
		const name =
			(this.component &&
				this.component.constructor &&
				this.component.constructor.name) ||
			'MC';
		return `[${name}]`;
	}

	/**
	 * Лог ошибки — виден ВСЕГДА
	 * @param {string} title
	 * @param {Array<string>} textArray
	 */
	error(title, textArray) {
		const prefix = this._prefix();
		console.groupCollapsed(
			`%c${prefix} ✖ ${title}`,
			'color: #ff5959; font-weight: bold;'
		);
		for (const text of textArray) {
			console.error(text);
		}
		console.groupEnd();
	}

	/**
	 * Лог предупреждения — виден ВСЕГДА
	 * @param {string} title
	 * @param {Array<string>} textArray
	 */
	warn(title, textArray) {
		const prefix = this._prefix();
		console.groupCollapsed(
			`%c${prefix} ⚠ ${title}`,
			'color: #ff8500; font-weight: bold;'
		);
		for (const text of textArray) {
			console.warn(text);
		}
		console.groupEnd();
	}

	/**
	 * Информационный лог — виден только при MC.debugMode = true
	 * @param {string} title
	 * @param {Array<string>} textArray
	 */
	info(title, textArray) {
		if (!MC.debugMode) return;

		const prefix = this._prefix();
		console.groupCollapsed(
			`%c${prefix} ℹ ${title}`,
			'color: #4a9eff; font-weight: bold;'
		);
		for (const text of textArray) {
			console.info(text);
		}
		console.groupEnd();
	}

	/**
	 * Отладочный лог — виден только при MC.debugMode = true
	 * @param {string} title
	 * @param {Array<string>} textArray
	 */
	debug(title, textArray) {
		if (!MC.debugMode) return;

		const prefix = this._prefix();
		console.groupCollapsed(
			`%c${prefix} 🔍 ${title}`,
			'color: #888; font-weight: normal;'
		);
		for (const text of textArray) {
			console.log(text);
		}
		console.groupEnd();
	}
}

// =================== ENGINE ===================

class MCEngine {
	mc;

	constructor(mc) {
		this.mc = mc;
		this.diff = new MCDiff(this.mc);
	}

	jqToHtml(jqSelector) {
		if (!jqSelector) return null;
		const html = jqSelector[0];
		return html || null;
	}

	/**
	 * Нормализует результат render() перед diff.
	 *
	 * Обрабатывает пять случаев:
	 * 1) null/undefined → пустой <mc> элемент
	 * 2) DocumentFragment ($('</>').append(...)) → <mc style="display:contents">
	 * 3) Тот же элемент, что уже является корнем компонента (persistent DOM:
	 *    return $(this.canvas)) → возвращает как есть, без обёртки
	 * 4) Чужой MC-компонент (provider: return $.MC(Child)) → <mc> обёртка
	 * 5) Обычный DOM-узел → возвращает как есть
	 *
	 * @param {jQuery|HTMLElement|DocumentFragment|null} jqResult — результат render()
	 * @param {HTMLElement|undefined} currentHTML — текущий VDOM.HTML (при re-render)
	 * @returns {HTMLElement} — один DOM-элемент, готовый к diff
	 */
	_normalizeRenderResult(jqResult, currentHTML) {
		let rawNode;

		if (!jqResult) {
			rawNode = null;
		} else if (jqResult.nodeType) {
			// Сырой DOM-узел (от return $.MC(Child) или return $(this.canvas))
			rawNode = jqResult;
		} else {
			// jQuery-объект (обычный return $('<div>'))
			rawNode = this.jqToHtml(jqResult);
		}

		// 1) Пустой результат
		if (!rawNode) {
			return new MC_Element().createEmptyElement();
		}

		// 2) DocumentFragment → wrap в <mc style="display:contents">
		if (rawNode.nodeType === Node.DOCUMENT_FRAGMENT_NODE) {
			const wrapper = document.createElement('mc');
			wrapper.setAttribute('style', 'display:contents');
			wrapper.__mc_fragment = true;

			while (rawNode.firstChild) {
				wrapper.appendChild(rawNode.firstChild);
			}

			return wrapper;
		}

		// 3) Persistent DOM: render() вернул тот же элемент, который уже
		//    является корнем этого компонента (canvas, container, etc.)
		//    Не оборачивать — иначе appendChild выдернет его из DOM
		//    и diff получит HierarchyRequestError.
		if (currentHTML && rawNode === currentHTML) {
			return rawNode;
		}

		// 4) Provider pattern: render() вернул чужой MC-компонент
		//    Оборачиваем чтобы два VDOM не указывали на один DOM-узел
		if (rawNode.instanceMC) {
			const wrapper = document.createElement('mc');
			wrapper.setAttribute('style', 'display:contents');
			wrapper.__mc_fragment = true;
			wrapper.appendChild(rawNode);
			return wrapper;
		}

		// 5) Обычный элемент — как раньше
		return rawNode;
	}

	/**
	 * Diffing для функционального контейнера
	 */
	diffing(VDOM) {
		const root = _getRoot();
		if (root) root._userRenderDepth++;
		const JQ_CONTAINER = VDOM.draw(
			this.getArrayValuesStates(VDOM),
			VDOM.props
		);
		if (root) root._userRenderDepth--;

		const NEW_HTML = this._normalizeRenderResult(JQ_CONTAINER, VDOM.HTML);

		NEW_HTML.instanceMC = VDOM.id;
		NEW_HTML.instanceMCtype = 'fn';

		// Persistent DOM: render вернул тот же элемент.
		// Diff не нужен — компонент управляет этим элементом императивно.
		if (NEW_HTML !== VDOM.HTML) {
			VDOM.HTML = this.diff.start(VDOM.HTML, NEW_HTML);
		}
	}

	/**
	 * Формирование состояния реквизита
	 */
	formationStates(VDOM) {
		const stateObject = {};

		for (const state of VDOM.normalized.states) {
			if (state.incorrectStateBindError) {
				continue;
			}

			stateObject[state.nameProp] = [
				state.get(),
				(value) => state.set(value),
				state,
			];
		}

		return stateObject;
	}

	getComponentLifecycleArgs(VDOM) {
		return [this.formationStates(VDOM), VDOM.normalized.props, VDOM];
	}

	/**
	 * Diffing для class-компонента
	 */
	diffingComponent(VDOM) {
		const root = _getRoot();
		root.setCurrentRenderingInstance(VDOM.key);

		const stateObject = this.formationStates(VDOM);
		root._userRenderDepth++;
		const JQ_CONTAINER = VDOM.draw.call(
			VDOM.component,
			stateObject,
			VDOM.normalized.props,
			VDOM
		);
		root._userRenderDepth--;

		root.resetCurrentRenderingInstance();

		const NEW_HTML = this._normalizeRenderResult(JQ_CONTAINER, VDOM.HTML);
		NEW_HTML.instanceMC = VDOM.id;
		NEW_HTML.instanceMCtype = 'mc_component';

		const prevHTML = VDOM.HTML;

		// Persistent DOM: render вернул тот же корневой элемент.
		// Diff не нужен — компонент управляет этим элементом императивно.
		// updated() lifecycle всё равно вызываем.
		if (NEW_HTML !== prevHTML) {
			VDOM.HTML = this.diff.start(VDOM.HTML, NEW_HTML);
		}

		if (VDOM._mountedCalled && VDOM.HTML && VDOM.HTML.isConnected) {
			const r = _getRoot();
			try {
				if (r) r._isInLifecycleCallback = true;
				if (typeof VDOM.updated === 'function') {
					VDOM.updated.call(VDOM.component, prevHTML, VDOM.HTML, VDOM);
				} else if (typeof VDOM.component.updated === 'function') {
					VDOM.component.updated(VDOM.HTML, VDOM, prevHTML);
				}
			} catch (e) {
				if (r) r.log.error('updated() lifecycle error', [String(e)]);
			} finally {
				if (r) r._isInLifecycleCallback = false;
			}
		}
	}

	/**
	 * Рендер (первичная отрисовка) — вызывается при создании VDOM
	 */
	rerender(VDOM, type) {
		type = type || 'fn';
		let NEW_HTML = null;
		const root = _getRoot();

		if (type === 'mc_component') {
			root.setCurrentRenderingInstance(VDOM.component.uniquekey);

			const stateObject = this.formationStates(VDOM);
			if (root) root._userRenderDepth++;
			const JQ_CONTAINER = VDOM.draw.call(
				VDOM.component,
				stateObject,
				VDOM.normalized.props,
				VDOM
			);
			if (root) root._userRenderDepth--;
			root.deleteKeyCurrentRenderingInstance(VDOM.component.uniquekey);

			NEW_HTML = this._normalizeRenderResult(JQ_CONTAINER, VDOM.HTML);
			NEW_HTML.instanceMC = VDOM.id;
			NEW_HTML.instanceMCtype = 'mc_component';
			VDOM.HTML = NEW_HTML;
		} else {
			if (root) root._userRenderDepth++;
			const JQ_CONTAINER = VDOM.draw(
				this.getArrayValuesStates(VDOM),
				VDOM.props
			);
			if (root) root._userRenderDepth--;

			NEW_HTML = this._normalizeRenderResult(JQ_CONTAINER, VDOM.HTML);
			NEW_HTML.instanceMC = VDOM.id;
			NEW_HTML.instanceMCtype = 'fn';
			VDOM.HTML = NEW_HTML;
		}

		return VDOM.HTML;
	}

	/**
	 * Контролируемый рендер (diffing с патчингом)
	 */
	controlledRender(VDOM, type) {
		type = type || 'mc_component';

		if (type === 'mc_component') {
			this.diffingComponent(VDOM);
			return;
		}

		this.diffing(VDOM);
	}

	getArrayValuesStates(virtual) {
		return Array.from(virtual.states.values());
	}

	/**
	 * Регистрация состояния — помечает как готовое к обновлениям.
	 */
	registrController(state) {
		state._registered = true;
	}
}

// =================== MC_Element ===================

class MC_Element {
	constructor(html) {
		return this.getComponent(html);
	}

	createEmptyElement() {
		const el = document.createElement('mc');
		el.setAttribute('style', 'height: 0; width: 0; display: none;');
		return el;
	}

	getComponent(HTML) {
		return HTML;
	}
}

// =================== SERVICE DIFF ===================

class ServiceDiff {
	serviceArrtibute;

	constructor() {
		this.serviceArrtibute = new Set();
		this.serviceArrtibute.add('mc_rnd_model_controlled');
	}

	checkServiceAttribute(name) {
		return this.serviceArrtibute.has(name);
	}
}

/**
 * Флаг подавления трекинга событий.
 * Когда true — патч $.fn.on НЕ записывает в __mcEvents,
 * чтобы applyEvents() не дублировал записи.
 */
let _mc_suppress_event_track = false;

// =================== EVENT DIFF (jQuery-based) ===================

class EventDiff {
	normalize(map) {
		const out = {};
		const src = map || {};
		for (const ev in src) {
			const arr = Array.isArray(src[ev]) ? src[ev].filter(Boolean) : [];
			out[ev] = Array.from(new Set(arr));
		}
		return out;
	}

	diffEvents(oldNode, newNode, ctx) {
		const oldEvents = this.normalize(oldNode.__mcEvents);
		const newEvents = this.normalize(newNode.__mcEvents);

		const add = {};
		const remove = {};

		for (const ev in oldEvents) {
			const oldArr = oldEvents[ev] || [];
			const newArr = newEvents[ev] || [];
			const newSet = new Set(newArr);
			const toRemove = oldArr.filter((fn) => !newSet.has(fn));
			if (toRemove.length) remove[ev] = toRemove;
		}

		for (const ev in newEvents) {
			const newArr = newEvents[ev] || [];
			const oldArr = oldEvents[ev] || [];
			const oldSet = new Set(oldArr);
			const toAdd = newArr.filter((fn) => !oldSet.has(fn));
			if (toAdd.length) add[ev] = toAdd;
		}

		const removedTypes = [];
		for (const ev in oldEvents) {
			if (!newEvents[ev] || newEvents[ev].length === 0) {
				removedTypes.push(ev);
			}
		}

		return { add, remove, removedTypes, nextSnapshot: newEvents, ctx };
	}

	/**
	 * Применение diff событий.
	 * Используем jQuery для корректного снятия/установки обработчиков,
	 * т.к. jQuery оборачивает handler'ы во внутренние wrapper'ы,
	 * и нативный removeEventListener не снимет обработчик, добавленный через $.on().
	 *
	 * Совместимость: jQuery 1.0+ (bind/unbind) или 1.7+ (on/off).
	 */
	applyEvents(patch, domNode) {
		if (!patch || !domNode) return;

		domNode.__mcBound = domNode.__mcBound || {};
		domNode.__mcEvents = domNode.__mcEvents || {};

		// Подавляем трекинг в jQuery-патче, чтобы не дублировать записи.
		// __mcEvents будет перезаписан из nextSnapshot в шаге 4.
		_mc_suppress_event_track = true;

		try {
			const $el = window.$(domNode);
			const hasOff = typeof $el.off === 'function';
			const hasUnbind = typeof $el.unbind === 'function';

			// 1) Снимаем конкретные обработчики
			for (const ev in patch.remove || {}) {
				const arr = patch.remove[ev] || [];
				for (let i = 0; i < arr.length; i++) {
					try {
						if (hasOff) {
							$el.off(ev, arr[i]);
						} else if (hasUnbind) {
							$el.unbind(ev, arr[i]);
						}
					} catch (_e) {
						/* ignore */
					}
				}
			}

			// 2) Если тип события пропал полностью — снимаем все оставшиеся
			for (let i = 0; i < (patch.removedTypes || []).length; i++) {
				const ev = patch.removedTypes[i];
				const leftover = domNode.__mcBound[ev] || [];
				for (let j = 0; j < leftover.length; j++) {
					try {
						if (hasOff) {
							$el.off(ev, leftover[j]);
						} else if (hasUnbind) {
							$el.unbind(ev, leftover[j]);
						}
					} catch (_e) {
						/* ignore */
					}
				}
				delete domNode.__mcBound[ev];
				delete domNode.__mcEvents[ev];
			}

			// 3) Добавляем недостающие (через jQuery — чтобы .off() потом работал)
			const hasOn = typeof $el.on === 'function';
			const hasBind = typeof $el.bind === 'function';

			for (const ev in patch.add || {}) {
				const arr = patch.add[ev] || [];
				for (let i = 0; i < arr.length; i++) {
					try {
						if (hasOn) {
							$el.on(ev, arr[i]);
						} else if (hasBind) {
							$el.bind(ev, arr[i]);
						}
					} catch (_e) {
						/* ignore */
					}
				}
			}
		} finally {
			_mc_suppress_event_track = false;
		}

		// 4) Синхронизируем snapshot
		domNode.__mcEvents = patch.nextSnapshot || {};
		domNode.__mcBound = patch.nextSnapshot || {};
	}
}

// =================== ATTR DIFF ===================

class AttrDiff {
	serviceDiff;
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

		const isElement = oldNode.nodeType === 1 && newNode.nodeType === 1;
		const tag = isElement ? (newNode.tagName || '').toLowerCase() : '';
		const isCheckable =
			tag === 'input' &&
			(newNode.type === 'checkbox' || newNode.type === 'radio');

		for (const attr of newAttrs) {
			if (isCheckable && attr.name === 'checked') continue;
			if (oldNode.getAttribute(attr.name) !== attr.value) {
				set[attr.name] = attr.value;
			}
		}

		for (const attr of oldAttrs) {
			if (isCheckable && attr.name === 'checked') continue;
			if (
				(tag === 'input' || tag === 'textarea' || tag === 'select') &&
				attr.name === 'value'
			) {
				continue;
			}
			if (!newNode.hasAttribute(attr.name)) {
				remove.push(attr.name);
			}
		}

		if (isElement) {
			if (tag === 'input' || tag === 'textarea' || tag === 'select') {
				const oldVal =
					oldNode.value != null
						? String(oldNode.value)
						: oldNode.getAttribute('value');
				const newVal =
					newNode.value != null
						? String(newNode.value)
						: newNode.getAttribute('value');
				if (oldVal !== newVal) {
					set.value = newVal == null ? '' : newVal;
				}
			}

			if (isCheckable) {
				const oldChecked = !!oldNode.checked;
				const newChecked = !!newNode.checked;
				if (oldChecked !== newChecked) {
					if (newChecked) {
						set.checked = 'checked';
					} else {
						remove.push('checked');
					}
				}
			}
		}

		return { set, remove, ctx };
	}

	applyAttributes(attrPatch, domNode) {
		if (!attrPatch) return;

		for (const [attr, val] of Object.entries(attrPatch.set || {})) {
			if (attr === 'value') {
				try {
					if ('value' in domNode) domNode.value = val;
				} catch (_e) {
					/* ignore */
				}
				domNode.setAttribute('value', val);

				if (
					domNode.tagName &&
					domNode.tagName.toLowerCase() === 'select'
				) {
					const desired = String(val);
					for (const opt of domNode.options || []) {
						const isSelected = opt.value === desired;
						opt.selected = isSelected;
						if (isSelected) {
							opt.setAttribute('selected', 'selected');
						} else {
							opt.removeAttribute('selected');
						}
					}
				}
				continue;
			}

			if (attr === 'checked') {
				if ('checked' in domNode) domNode.checked = true;
				domNode.setAttribute('checked', 'checked');
				continue;
			}

			domNode.setAttribute(attr, val);
		}

		for (const attr of attrPatch.remove || []) {
			if (attr === 'checked') {
				if ('checked' in domNode) domNode.checked = false;
				domNode.removeAttribute('checked');
				continue;
			}
			if (attr === 'value') {
				domNode.removeAttribute('value');
				continue;
			}
			domNode.removeAttribute(attr);
		}
	}
}

// =================== STYLE DIFF ===================

class StyleDiff {
	diffStyles(oldNode, newNode, ctx) {
		const oldStyle =
			(oldNode.getAttribute && oldNode.getAttribute('style')) || '';
		const newStyle =
			(newNode.getAttribute && newNode.getAttribute('style')) || '';
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
		const oldClass =
			(oldNode.getAttribute && oldNode.getAttribute('class')) || '';
		const newClass =
			(newNode.getAttribute && newNode.getAttribute('class')) || '';
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

// =================== MASTER DIFF ===================

class MasterDiff {
	attrDiff;
	styleDiff;
	classDiff;
	eventDiff;
	mc;

	constructor(attrDiff, styleDiff, classDiff, eventDiff, mc) {
		this.attrDiff = attrDiff;
		this.styleDiff = styleDiff;
		this.classDiff = classDiff;
		this.eventDiff = eventDiff;
		this.mc = mc;
	}

	_getStableChildKey(node) {
		if (!node || node.nodeType !== Node.ELEMENT_NODE) return null;
		if (!node.instanceMC || !node.instanceMCtype) return null;

		const rootMC = _getRoot();
		if (!rootMC) return null;

		if (node.instanceMCtype === 'mc_component') {
			const componentKey = rootMC.componentIdsCollection.get(
				node.instanceMC
			);
			return componentKey ? `mc:${componentKey}` : null;
		}

		if (node.instanceMCtype === 'fn') {
			const fnKey = rootMC.fcIdsCollection.get(node.instanceMC);
			return fnKey ? `fn:${fnKey}` : null;
		}

		return null;
	}

	_isKeyedChild(node) {
		return !!this._getStableChildKey(node);
	}

	cleanupVDOM(oldNode, newNode) {
		const rootMC = _getRoot();
		if (!rootMC) return;

		// --- FN контейнеры ---
		if (oldNode.instanceMCtype === 'fn') {
			const id = oldNode.instanceMC;
			const oldKey = rootMC.fcIdsCollection.get(id);

			const fnRemoved =
				!newNode.instanceMC ||
				newNode.instanceMCtype !== 'fn' ||
				newNode.instanceMC !== oldNode.instanceMC;

			if (fnRemoved && oldKey) {
				try {
					rootMC._cleanupFunctionContainerByKey(oldKey, true);
				} catch (_e) {
					const vdom = rootMC.fcCollection.get(oldKey);
					if (vdom) vdom.HTML = null;
				}
			}

			if (
				newNode.instanceMCtype === 'fn' &&
				newNode.instanceMC
			) {
				oldNode.instanceMC = newNode.instanceMC;
				oldNode.instanceMCtype = 'fn';
			} else {
				oldNode.instanceMC = undefined;
				oldNode.instanceMCtype = undefined;
			}
			return;
		}

		// --- Class компоненты ---
		if (oldNode.instanceMCtype === 'mc_component') {
			const id = oldNode.instanceMC;
			const oldKey = rootMC.componentIdsCollection.get(id);

			const compRemoved =
				!newNode.instanceMC ||
				newNode.instanceMCtype !== 'mc_component' ||
				newNode.instanceMC !== oldNode.instanceMC;

			if (compRemoved && oldKey) {
				rootMC._cleanupComponentByKey(oldKey, true);
			} else {
				const vdom = oldKey
					? rootMC.componentCollection.get(oldKey)
					: null;
				if (vdom) vdom.HTML = null;
			}

			if (
				newNode.instanceMCtype === 'mc_component' &&
				newNode.instanceMC
			) {
				oldNode.instanceMC = newNode.instanceMC;
				oldNode.instanceMCtype = 'mc_component';
			} else {
				oldNode.instanceMC = undefined;
				oldNode.instanceMCtype = undefined;
			}
			return;
		}
	}

	diffNode(oldNode, newNode, ctx) {
		const context = Object.assign({ level: 0, path: '' }, ctx);

		if (!oldNode && newNode) {
			return { type: 'ADD', node: newNode, ctx: context };
		}
		if (oldNode && !newNode) {
			return { type: 'REMOVE', ctx: context };
		}
		if (!oldNode && !newNode) {
			return { type: 'NONE', ctx: context };
		}

		if (
			oldNode.instanceMC &&
			newNode.instanceMC &&
			oldNode.instanceMC !== newNode.instanceMC
		) {
			this.cleanupVDOM(oldNode, newNode);
		}

		if (oldNode.instanceMC && !newNode.instanceMC) {
			this.cleanupVDOM(oldNode, newNode);
		}

		if (!oldNode.instanceMC && newNode.instanceMC) {
			oldNode.instanceMC = newNode.instanceMC;
			oldNode.instanceMCtype = newNode.instanceMCtype;
		}

		if (oldNode.nodeType !== newNode.nodeType) {
			return { type: 'REPLACE', node: newNode, ctx: context };
		}

		if (oldNode.nodeType === Node.TEXT_NODE) {
			if (oldNode.textContent !== newNode.textContent) {
				return { type: 'TEXT', text: newNode.textContent, ctx: context };
			}
			return { type: 'NONE', ctx: context };
		}

		if (oldNode.nodeType === Node.COMMENT_NODE) {
			if (oldNode.textContent !== newNode.textContent) {
				return {
					type: 'COMMENT',
					text: newNode.textContent,
					ctx: context,
				};
			}
			return { type: 'NONE', ctx: context };
		}

		if (
			oldNode.nodeType === Node.DOCUMENT_FRAGMENT_NODE ||
			oldNode.nodeType === Node.DOCUMENT_NODE ||
			oldNode.nodeType === Node.DOCUMENT_TYPE_NODE
		) {
			return this.diffChildren(oldNode, newNode, context);
		}

		if (oldNode.nodeType === Node.ELEMENT_NODE) {
			if (oldNode.nodeName !== newNode.nodeName) {
				return { type: 'REPLACE', node: newNode, ctx: context };
			}

			// Transfer ref callbacks/objects
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

			// Transfer host flag
			if (newNode.__mc_host) {
				oldNode.__mc_host = true;
			} else if (oldNode.__mc_host) {
				delete oldNode.__mc_host;
			}

			const attrPatch = this.attrDiff.diffAttributes(
				oldNode,
				newNode,
				context
			);
			const stylePatch = this.styleDiff.diffStyles(
				oldNode,
				newNode,
				context
			);
			const classPatch = this.classDiff.diffClasses(
				oldNode,
				newNode,
				context
			);
			const eventPatch = this.eventDiff.diffEvents(
				oldNode,
				newNode,
				context
			);

			if (oldNode.instanceMC && newNode.instanceMC) {
				if (oldNode.instanceMC !== newNode.instanceMC) {
					oldNode.instanceMC = newNode.instanceMC;
				}
			}

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

		return { type: 'REPLACE', node: newNode, ctx: context };
	}

	diffChildren(oldNode, newNode, ctx) {
		const context = Object.assign({}, ctx, {
			level: (ctx.level || 0) + 1,
		});
		const oldChildren = Array.from(oldNode.childNodes);
		const newChildren = Array.from(newNode.childNodes);

		const oldUsed = new Set();
		const opsByNewIndex = new Array(newChildren.length).fill(null);

		// 1) Индекс старых keyed-детей
		const oldKeyToIndex = new Map();
		for (let oldIndex = 0; oldIndex < oldChildren.length; oldIndex++) {
			const key = this._getStableChildKey(oldChildren[oldIndex]);
			if (key && !oldKeyToIndex.has(key)) {
				oldKeyToIndex.set(key, oldIndex);
			}
		}

		// 2) Матчим keyed-детей по ключу
		for (let newIndex = 0; newIndex < newChildren.length; newIndex++) {
			const newChild = newChildren[newIndex];
			const key = this._getStableChildKey(newChild);
			if (!key) continue;

			const oldIndex = oldKeyToIndex.get(key);
			const path = `${context.path}/${newIndex}`;

			if (oldIndex == null) {
				opsByNewIndex[newIndex] = {
					kind: 'ADD',
					newIndex,
					node: newChild,
					path,
				};
				continue;
			}

			oldUsed.add(oldIndex);
			opsByNewIndex[newIndex] = {
				kind: 'PATCH',
				oldIndex,
				newIndex,
				path,
				patch: this.diffNode(oldChildren[oldIndex], newChild, {
					...context,
					path,
				}),
			};
		}

		// 3) Остаток матчим позиционно по НЕ-keyed детям
		let oldCursor = 0;
		for (let newIndex = 0; newIndex < newChildren.length; newIndex++) {
			if (opsByNewIndex[newIndex]) continue;

			const newChild = newChildren[newIndex];
			const newChildIsKeyed = this._isKeyedChild(newChild);
			const path = `${context.path}/${newIndex}`;

			if (newChildIsKeyed) {
				opsByNewIndex[newIndex] = {
					kind: 'ADD',
					newIndex,
					node: newChild,
					path,
				};
				continue;
			}

			while (
				oldCursor < oldChildren.length &&
				(oldUsed.has(oldCursor) ||
					this._isKeyedChild(oldChildren[oldCursor]))
			) {
				oldCursor++;
			}

			if (oldCursor < oldChildren.length) {
				const oldIndex = oldCursor++;
				oldUsed.add(oldIndex);
				opsByNewIndex[newIndex] = {
					kind: 'PATCH',
					oldIndex,
					newIndex,
					path,
					patch: this.diffNode(oldChildren[oldIndex], newChild, {
						...context,
						path,
					}),
				};
			} else {
				opsByNewIndex[newIndex] = {
					kind: 'ADD',
					newIndex,
					node: newChild,
					path,
				};
			}
		}

		// 4) Неиспользованные old -> REMOVE
		const removes = [];
		for (let oldIndex = 0; oldIndex < oldChildren.length; oldIndex++) {
			if (!oldUsed.has(oldIndex)) {
				removes.push({
					kind: 'REMOVE',
					oldIndex,
					path: `${context.path}/${oldIndex}`,
				});
			}
		}

		return {
			type: 'CHILDREN',
			updates: opsByNewIndex.filter(Boolean),
			removes,
			ctx: context,
		};
	}
}

// =================== PATCH MASTER ===================

class PatchMaster {
	attrDiff;
	styleDiff;
	classDiff;
	eventDiff;
	mc;

	constructor(attrDiff, styleDiff, classDiff, eventDiff, mc) {
		this.attrDiff = attrDiff;
		this.styleDiff = styleDiff;
		this.classDiff = classDiff;
		this.eventDiff = eventDiff;
		this.mc = mc;
	}

	reconnectingVDOM(rootNode) {
		const rootMC = _getRoot();
		if (!rootMC) return;

		const toMount = new Set();

		const processEl = (el) => {
			if (!el || el.nodeType !== 1) return;

			const isConnected = !!el.isConnected;

			// --- ref-callback ---
			const cb =
				typeof el.__mc_ref_cb === 'function' ? el.__mc_ref_cb : null;
			const lastCb =
				typeof el.__mc_ref_last_cb === 'function'
					? el.__mc_ref_last_cb
					: null;

			if (!cb && lastCb && el.__mc_ref_mounted) {
				try {
					lastCb(null);
				} catch (e) {
					console.error(e);
				}
				el.__mc_ref_mounted = false;
				el.__mc_ref_last_cb = null;
			}

			if (cb && isConnected) {
				const changed = lastCb !== cb;
				const needCall = !el.__mc_ref_mounted || changed;

				if (needCall) {
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

			// --- ref-object ---
			const obj =
				el.__mc_ref_obj && typeof el.__mc_ref_obj === 'object'
					? el.__mc_ref_obj
					: null;
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

			// --- instanceMC ---
			if (!el.instanceMC) return;

			if (el.instanceMCtype === 'fn') {
				const key = el.instanceMC;
				const vdom = rootMC.fcCollection.get(
					rootMC.fcIdsCollection.get(key)
				);
				if (vdom) vdom.HTML = el;
				return;
			}

			if (el.instanceMCtype === 'mc_component') {
				const key = el.instanceMC;
				const vdom = rootMC.componentCollection.get(
					rootMC.componentIdsCollection.get(key)
				);
				if (vdom) {
					vdom.HTML = el;
					if (el.isConnected && !vdom._mountedCalled) {
						toMount.add(vdom);
					}
				}
			}
		};

		// Root
		if (
			rootNode &&
			rootNode.nodeType === 1 &&
			(rootNode.instanceMC ||
				rootNode.__mc_ref_cb ||
				rootNode.__mc_ref_obj ||
				rootNode.__mc_ref_last_cb ||
				rootNode.__mc_ref_last_obj)
		) {
			processEl(rootNode);
		}

		// Walk subtree
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

		// mounted вызов после reconnection
		toMount.forEach((vdom) => {
			if (!vdom || vdom._mountedCalled) return;
			if (!vdom.HTML || !vdom.HTML.isConnected) return;

			const compName =
				(vdom.component && vdom.component.constructor && vdom.component.constructor.name) ||
				'Unknown';

			try {
				const lifecycleArgs =
					rootMC.engine.getComponentLifecycleArgs(vdom);
				rootMC._isInLifecycleCallback = true;
				vdom.mounted.call(vdom.component, ...lifecycleArgs);
			} catch (e) {
				rootMC.log.error('Ошибка в mounted()', [
					`Компонент: ${compName}`,
					`key: ${vdom.key}`,
					String(e),
					e.stack || '',
				]);
			} finally {
				rootMC._isInLifecycleCallback = false;
			}

			vdom._mountedCalled = true;

			rootMC.log.debug('Компонент смонтирован', [
				`Компонент: ${compName}`,
				`key: ${vdom.key}`,
			]);
		});
	}

	_detachRefsOnEl(el) {
		if (!el || el.nodeType !== 1) return;

		const lastCb =
			typeof el.__mc_ref_last_cb === 'function'
				? el.__mc_ref_last_cb
				: null;
		const cb =
			typeof el.__mc_ref_cb === 'function' ? el.__mc_ref_cb : null;

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

		const lastObj =
			el.__mc_ref_last_obj && typeof el.__mc_ref_last_obj === 'object'
				? el.__mc_ref_last_obj
				: null;
		const obj =
			el.__mc_ref_obj && typeof el.__mc_ref_obj === 'object'
				? el.__mc_ref_obj
				: null;

		if (el.__mc_ref_obj_mounted) {
			const target = lastObj || obj;
			try {
				if (target) target.current = null;
			} catch (e) {
				console.error(e);
			}
		}

		el.__mc_ref_mounted = false;
		el.__mc_ref_obj_mounted = false;
		el.__mc_ref_last_cb = null;
		el.__mc_ref_last_obj = null;
	}

	_detachRefsDeep(root) {
		if (!root) return;

		if (root.nodeType === 1) {
			this._detachRefsOnEl(root);
		}

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

	applyPatch(patch, domNode, ctx) {
		if (!patch) return domNode;

		switch (patch.type) {
			case 'ADD':
				if (domNode && domNode.parentNode) {
					domNode.parentNode.appendChild(patch.node);
				}
				return patch.node;

			case 'REMOVE':
				if (domNode) {
					this._detachRefsDeep(domNode);
					if (domNode.parentNode) {
						domNode.parentNode.removeChild(domNode);
					}
				}
				return null;

			case 'REPLACE':
				if (domNode) {
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
				if (domNode) this._detachRefsDeep(domNode);
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
				if (domNode) this._detachRefsDeep(domNode);
				if (domNode && domNode.parentNode) {
					const comment = document.createComment(patch.text);
					domNode.parentNode.replaceChild(comment, domNode);
					return comment;
				}
				return document.createComment(patch.text);
			}

			case 'UPDATE':
				this.attrDiff.applyAttributes(patch.attrPatch, domNode);
				this.styleDiff.applyStyles(patch.stylePatch, domNode);
				this.classDiff.applyClasses(patch.classPatch, domNode);
				this.eventDiff.applyEvents(patch.eventPatch, domNode);
				this.applyPatch(patch.childrenPatch, domNode, ctx);
				return domNode;

			case 'CHILDREN':
				this._applyChildren(patch, domNode, ctx);
				return domNode;

			case 'NONE':
				return domNode;

			default:
				return domNode;
		}
	}

	_applyChildren(childrenPatch, domNode, ctx) {
		if (!childrenPatch) return;

		const updates = Array.isArray(childrenPatch.updates)
			? childrenPatch.updates
			: [];
		const removes = Array.isArray(childrenPatch.removes)
			? childrenPatch.removes
			: [];

		const originalChildren = Array.from(domNode.childNodes);

		// REMOVE справа налево
		for (let i = removes.length - 1; i >= 0; i--) {
			const op = removes[i];
			const child = originalChildren[op.oldIndex];
			if (!child || child.parentNode !== domNode) continue;
			this._detachRefsDeep(child);
			domNode.removeChild(child);
		}

		// ADD / PATCH в порядке newIndex
		for (let i = 0; i < updates.length; i++) {
			const op = updates[i];
			if (!op) continue;

			if (op.kind === 'ADD') {
				const anchor = domNode.childNodes[op.newIndex] || null;
				domNode.insertBefore(op.node, anchor);
				continue;
			}

			if (op.kind === 'PATCH') {
				const child = originalChildren[op.oldIndex];
				if (!child || child.parentNode !== domNode) continue;

				const anchor = domNode.childNodes[op.newIndex] || null;
				if (anchor !== child) {
					domNode.insertBefore(child, anchor);
				}
				this.applyPatch(op.patch, child, ctx);
			}
		}
	}
}

// =================== MC DIFF ===================

class MCDiff {
	master;
	patch;

	constructor(mc) {
		const serviceDiff = new ServiceDiff();
		const attrDiff = new AttrDiff(serviceDiff, mc);
		const styleDiff = new StyleDiff();
		const classDiff = new ClassDiff();
		const eventDiff = new EventDiff();

		this.master = new MasterDiff(
			attrDiff,
			styleDiff,
			classDiff,
			eventDiff,
			mc
		);
		this.patch = new PatchMaster(
			attrDiff,
			styleDiff,
			classDiff,
			eventDiff,
			mc
		);
	}

	start(oldNode, newNode) {
		// Ранний выход: тот же узел — diff не нужен.
		// Это бывает когда компонент возвращает persistent DOM (canvas, container).
		if (oldNode && oldNode === newNode) {
			return oldNode;
		}

		const mc = _getRoot();

		try {
			if (mc) mc._domObserverSuppress++;

			const trace = this.master.diffNode(oldNode, newNode, {
				level: 0,
				path: '',
			});
			const node = this.patch.applyPatch(trace, oldNode, {
				level: 0,
				path: '',
			});

			if (node) {
				this.patch.reconnectingVDOM(node);
			}

			return node;
		} finally {
			if (mc) mc._domObserverSuppress--;
		}
	}
}

// =================== MC_Component ===================

class MC_Component {
	mc;

	constructor(mc) {
		this.mc = mc;
	}

	createNewInstance(normalized) {
		const root = _getRoot();
		const instance = new normalized.component(
			normalized.props,
			normalized.context,
			normalized.uniquekey
		);
		instance.mc = root;
		return instance;
	}

	createSignatureComponent(normalized, id) {
		const root = _getRoot();
		const instance = this.createNewInstance(normalized);
		instance.uniquekey = normalized.uniquekey;
		instance.parentKey = root.getCurrentRenderingInstance();

		const virtualElement = {
			draw: instance.render,
			mounted: instance.mounted ? instance.mounted : () => {},
			updated: instance.updated ? instance.updated : () => {},
			_mountedCalled: false,
			unmounted: instance.unmounted ? instance.unmounted : () => {},
			key: normalized.key,
			id,
			states: new Map(),
			context: normalized.context,
			HTML: new MC_Element().createEmptyElement(),
			normalized: normalized,
			component: instance,
		};

		for (const prop in instance) {
			if (instance[prop] instanceof MCState) {
				const localState = instance[prop];

				if (localState.local && !localState.traceKey) {
					localState.traceKey = root.buildLocalStateTraceKey(
						normalized.key
					);
					localState.nameProp = prop;
					normalized.states.push(instance[prop]);
				}
			}
		}

		instance.componentCollection.set(normalized.key, virtualElement);
		instance.componentIdsCollection.set(id, normalized.key);

		root.componentCollection.set(normalized.key, virtualElement);
		root.componentIdsCollection.set(id, normalized.key);

		return virtualElement;
	}

	register(normalized, id) {
		const root = _getRoot();
		const NativeVirtual = this.createSignatureComponent(normalized, id);

		if (normalized.states.length) {
			for (const state of normalized.states) {
				if (root.isStateLike(state)) {
					state.virtualCollection.add({
						effectKey: NativeVirtual.key,
					});
					NativeVirtual.states.set(state.id, state.value);
				} else {
					root.log.error('Неверный стейт', [
						'Переданная сигнатура состояния неверна. Проверьте данные которые вы передали в зависимости',
					]);
				}
			}
		}

		this.start(NativeVirtual);

		NativeVirtual.HTML.instanceMC = NativeVirtual.id;
		NativeVirtual.HTML.instanceMCtype = 'mc_component';

		return NativeVirtual.HTML;
	}

	start(NativeVirtual) {
		const root = _getRoot();

		if (root.getCurrentRenderingInstance()) {
			NativeVirtual.HTML = root.engine.rerender(
				NativeVirtual,
				'mc_component'
			);
			return;
		}

		root.engine.controlledRender(NativeVirtual, 'mc_component');
	}
}

// =================== MC CONTEXT ===================

class MCcontext {
	id;
	key;
	virtualCollection;

	constructor(param) {
		const { id, key } = param;
		this.id = id;
		this.key = key ?? null;
		this.virtualCollection = new Set();
	}

	create(component, id, key) {
		const virtualElement = {
			component: component,
			parent_id: this.id,
			key: id,
			identifier: key,
		};

		this.virtualCollection.add(virtualElement);

		return [{ context: this.id, id_element: id }, virtualElement];
	}
}

// =================== MC (ROOT) ===================

/**
 * MCv8
 * Основная сущность для взаимодействия MC
 */
class MC {
	/**
	 * Ссылка на оригинальный jq variable
	 */
	original$;

	/**
	 * Активный экземпляр MC (ссылка на MC-класс или root)
	 */
	mc;

	/**
	 * Список ключей состояний для MC
	 */
	stateList;

	/**
	 * Хранилище состояний
	 */
	mc_state_global;

	/**
	 * O(1) индекс: id → MCState
	 */
	_stateById;

	/**
	 * Хранилище контекстов
	 */
	mc_context_global;

	/**
	 * Свойство планировщика очистки
	 */
	_cleaningScheduled;

	/**
	 * Коллекция функциональных контейнеров
	 */
	fcCollection;
	fcIdsCollection;

	/**
	 * Коллекция компонентов
	 */
	componentCollection;
	componentIdsCollection;

	/**
	 * Обработчик компонентов
	 */
	componentHandler;

	/**
	 * Компоненты в render
	 */
	currentRenderingInstance;

	/**
	 * Список отложенных запросов на перерисовку
	 */
	listPendingRedrawRequests;

	/**
	 * Маркер: это корневой экземпляр MC (не подкласс-компонент).
	 * Устанавливается в MC.init().
	 */
	_isMCRootInstance;

	constructor() {
		this._isMCRootInstance = false; // будет true только у singleton
		this._pendingMountRoots = new Set();
		this._mountObserver = null;
		this.log = new MCLog(this);
		this.engine = new MCEngine(this);
		this.componentHandler = new MC_Component(this);
		this.stateList = new Map();

		this.fcCollection = new Map();
		this.fcIdsCollection = new Map();

		this.effectCollection = new Map();
		this.effectIdsCollection = new Map();

		this.componentCollection = new Map();
		this.componentIdsCollection = new Map();

		this.currentRenderingInstance = new Set();
		this.TREE_KEY_SEPARATOR = '%=>%';
		this.EFFECT_PARENT_SEPARATOR = '__';

		this.COUNTER_CLEAR = 150;
		this.checkCountClearedFunctionContainers = this.COUNTER_CLEAR;

		this.mc_state_global = new Set();
		this._stateById = new Map();

		this.mc_context_global = new Set();
		this._cleaningScheduled = false;
		this.listPendingRedrawRequests = new Set();

		this._batching = false;
		this._batchingEffects = false;
		this._batchUpdateScheduled = false;
		this._suppressFlush = false;
		this._userRenderDepth = 0;
		this._isInEffectCallback = false;
		this._isInLifecycleCallback = false;
		this._reflushCount = 0;
		this._pendingDeferredEffects = new Set();

		// DOM observer / cleanup
		this._domObserver = null;
		this._domObserverSuppress = 0;
		this._obsRemovedRoots = new Set();
		this._obsAddedRoots = new Set();
		this._obsFlushScheduled = false;

		if (typeof window !== 'undefined' && window.$) {
			this.original$ = window.$;
		}
	}

	// =================== FLUSH (batch render) ===================

	/**
	 * Планирует flush через queueMicrotask, если ещё не запланирован.
	 */
	_scheduleFlush() {
		if (this._batchUpdateScheduled || this._suppressFlush) return;
		this._batchUpdateScheduled = true;
		this._reflushCount = 0;

		queueMicrotask(() => {
			try {
				this._runFlush();
			} catch (e) {
				this._batchUpdateScheduled = false;
				this.log.error('Критическая ошибка flush', [String(e), e.stack || '']);
			}
		});
	}

	/**
	 * Основной flush — обрабатывает все накопленные изменения состояний.
	 * Вызывается из microtask. Содержит error boundaries для каждого
	 * отдельного diffing/effect, чтобы ошибка в одном компоненте
	 * не обрушивала весь цикл.
	 */
	_runFlush() {
		const pending = this.listPendingRedrawRequests;
		let ids = [];

		if (pending) {
			ids = Array.from(pending);
			pending.clear();
		}

		if (!ids.length) {
			this._batchUpdateScheduled = false;
			return;
		}

		// Защита от бесконечного цикла re-flush
		this._reflushCount = (this._reflushCount || 0) + 1;
		if (this._reflushCount > MC.MAX_REFLUSH) {
			this._batchUpdateScheduled = false;
			this.log.error('Бесконечный цикл re-flush', [
				`Превышен лимит ${MC.MAX_REFLUSH} последовательных flush.`,
				'Вероятно, state.set() вызывается внутри render() или effect без условия выхода.',
				'Проверьте компоненты, которые безусловно вызывают set() в render().',
				`Последние state ID в очереди: ${ids.slice(0, 5).join(', ')}`,
			]);
			return;
		}

		const debugTiming = MC.debugMode;
		const t0 = debugTiming ? performance.now() : 0;

		const getDepth = (st) =>
			this.getTreeDepthFromKey(st?.traceKey ?? st?.nameProp ?? '');
		const isGlobal = (st) => !st?.local;

		// 1) Собираем валидные dirty states
		const dirtyStates = [];
		for (let i = 0; i < ids.length; i++) {
			const st = this.getStateID(ids[i]);
			if (!st || !st._registered) continue;
			dirtyStates.push(st);
		}

		// 2) Сортировка: глобальные → локальные (deep-first)
		dirtyStates.sort((a, b) => {
			const ag = isGlobal(a);
			const bg = isGlobal(b);
			if (ag !== bg) return ag ? -1 : 1;

			if (!ag) {
				const da = getDepth(a);
				const db = getDepth(b);
				if (da !== db) return db - da;
			}

			const ka = String(a.traceKey ?? a.nameProp ?? '');
			const kb = String(b.traceKey ?? b.nameProp ?? '');
			return ka < kb ? -1 : ka > kb ? 1 : 0;
		});

		// 3) Дедуп по VDOM ключам
		const dirtyFC = new Map();
		const dirtyVC = new Map();
		const dirtyEffectKeys = new Set();

		const engine = this.engine;

		this._batching = true;
		this._batchingEffects = true;

		try {
			for (let i = 0; i < dirtyStates.length; i++) {
				const st = dirtyStates[i];
				const depth = getDepth(st);

				// FC (function containers)
				if (st.fcCollection && st.fcCollection.size) {
					st.fcCollection.forEach((item) => {
						const v = this.fcCollection.get(item.effectKey);
						if (!v) return;
						v.states.set(st.id, st.value);
						const prev = dirtyFC.get(item.effectKey);
						if (prev == null || depth > prev) {
							dirtyFC.set(item.effectKey, depth);
						}
					});
				}

				// VC (components)
				if (st.virtualCollection && st.virtualCollection.size) {
					st.virtualCollection.forEach((item) => {
						const v = this.componentCollection.get(item.effectKey);
						if (!v) return;
						v.states.set(st.id, st.value);
						const prev = dirtyVC.get(item.effectKey);
						if (prev == null || depth > prev) {
							dirtyVC.set(item.effectKey, depth);
						}
					});
				}

				// Effects
				if (st.effectCollection && st.effectCollection.size) {
					st.effectCollection.forEach((item) => {
						const eff = this.effectCollection.get(item.effectKey);
						if (!eff) return;
						const prev = eff.states.get(st.id);
						if (prev !== st.value) {
							eff.states.set(st.id, st.value);
							dirtyEffectKeys.add(item.effectKey);
						}
					});
				}
			}
		} finally {
			this._batching = false;
			this._batchingEffects = false;
		}

		// 4) DOM diff: каждый VDOM ровно один раз

		// FC — по depth (глубже → раньше)
		const fcKeys = Array.from(dirtyFC.entries())
			.sort((a, b) => b[1] - a[1])
			.map(([k]) => k);

		for (let i = 0; i < fcKeys.length; i++) {
			const v = this.fcCollection.get(fcKeys[i]);
			if (!v) continue;
			try {
				engine.diffing(v);
			} catch (e) {
				this.log.error('Ошибка рендеринга FC', [
					`key: ${fcKeys[i]}`,
					`Функция: ${v.draw ? v.draw.name || '(anonymous)' : 'unknown'}`,
					String(e),
					e.stack || '',
				]);
			}
		}

		// Components — deep-first (ребёнок → родитель)
		const vcKeys = Array.from(dirtyVC.entries())
			.sort((a, b) => b[1] - a[1])
			.map(([k]) => k);

		for (let i = 0; i < vcKeys.length; i++) {
			const v = this.componentCollection.get(vcKeys[i]);
			if (!v) continue;
			try {
				engine.diffingComponent(v);
			} catch (e) {
				const compName =
					(v.component && v.component.constructor && v.component.constructor.name) ||
					'Unknown';
				this.log.error('Ошибка рендеринга компонента', [
					`Компонент: ${compName}`,
					`key: ${vcKeys[i]}`,
					String(e),
					e.stack || '',
				]);
			}
		}

		// 5) Effects после DOM-коммита
		dirtyEffectKeys.forEach((effectKey) => {
			const eff = this.effectCollection.get(effectKey);
			if (!eff) return;

			// Deferred-эффекты откладываются до завершения ВСЕХ flush-циклов
			if (eff._deferred) {
				this._pendingDeferredEffects.add(effectKey);
				return;
			}

			try {
				this._isInEffectCallback = true;
				const unmountCallFunction = eff.run(
					engine.getArrayValuesStates(eff),
					eff.options
				);
				if (unmountCallFunction) {
					eff.unmountCaller = unmountCallFunction;
				}
			} catch (e) {
				this.log.error('Ошибка эффекта', [
					`key: ${effectKey}`,
					`parent: ${eff.parent || 'global'}`,
					String(e),
					e.stack || '',
				]);
			} finally {
				this._isInEffectCallback = false;
			}
		});

		// Debug timing
		if (debugTiming) {
			const t1 = performance.now();
			const dur = (t1 - t0).toFixed(2);
			const total = dirtyStates.length;
			const fcCount = fcKeys.length;
			const vcCount = vcKeys.length;
			const effCount = dirtyEffectKeys.size;

			this.log.debug('Flush завершён', [
				`Время: ${dur}ms`,
				`States: ${total}, FC: ${fcCount}, Components: ${vcCount}, Effects: ${effCount}`,
				this._reflushCount > 1 ? `Re-flush #${this._reflushCount}` : '',
			].filter(Boolean));

			if (parseFloat(dur) > 16) {
				this.log.warn('Медленный flush', [
					`Flush занял ${dur}ms (больше одного кадра при 60fps).`,
					`Обработано: ${total} states, ${fcCount} FC, ${vcCount} компонентов, ${effCount} эффектов`,
					'Рассмотрите разделение крупных компонентов или уменьшение количества подписок.',
				]);
			}
		}

		// 6) Если в процессе появились новые set() — ещё раз
		if (this.listPendingRedrawRequests.size) {
			queueMicrotask(() => {
				try {
					this._runFlush();
				} catch (e) {
					this._batchUpdateScheduled = false;
					this.log.error('Ошибка re-flush', [String(e), e.stack || '']);
				}
			});
			return;
		}

		this._batchUpdateScheduled = false;

		// 7) Deferred-эффекты — запускаются ПОСЛЕ завершения всех flush-циклов
		if (this._pendingDeferredEffects.size) {
			this._drainDeferredEffects();
		}
	}

	/**
	 * Запускает все отложенные эффекты.
	 * Вызывается после полного завершения flush-цикла (включая re-flush).
	 * 
	 * К этому моменту:
	 * — DOM полностью обновлён
	 * — все mounted() вызваны
	 * — все refs актуальны
	 * — _batchUpdateScheduled = false
	 *
	 * Если deferred-эффект вызовет set(), это запланирует новый
	 * полноценный flush-цикл через _scheduleFlush().
	 */
	_drainDeferredEffects() {
		const keys = Array.from(this._pendingDeferredEffects);
		this._pendingDeferredEffects.clear();

		if (!keys.length) return;

		this.log.debug('Запуск отложенных эффектов', [
			`Количество: ${keys.length}`,
			`Ключи: ${keys.slice(0, 5).join(', ')}${keys.length > 5 ? '...' : ''}`,
		]);

		for (let i = 0; i < keys.length; i++) {
			const effectKey = keys[i];
			const eff = this.effectCollection.get(effectKey);

			// Эффект мог быть удалён (компонент unmounted во время flush)
			if (!eff) continue;

			try {
				this._isInEffectCallback = true;
				const unmountCallFunction = eff.run(
					this.engine.getArrayValuesStates(eff),
					eff.options
				);
				if (unmountCallFunction) {
					eff.unmountCaller = unmountCallFunction;
				}
			} catch (e) {
				this.log.error('Ошибка отложенного эффекта', [
					`key: ${effectKey}`,
					`parent: ${eff.parent || 'global'}`,
					String(e),
					e.stack || '',
				]);
			} finally {
				this._isInEffectCallback = false;
			}
		}
	}

	// =================== STATIC API ===================

	/**
	 * Режим отладки.
	 * При true — MCLog показывает info() и debug() сообщения.
	 * По умолчанию false.
	 */
	static debugMode = false;

	/**
	 * Лимит рекурсивных re-flush (защита от бесконечного цикла).
	 */
	static MAX_REFLUSH = 100;

	/**
	 * Обратно-совместимый вызов инициализации.
	 * Безопасно вызывать многократно — повторные вызовы игнорируются.
	 * С v8.1 вызов необязателен: MC инициализируется автоматически
	 * при загрузке скрипта (если jQuery доступен) или при первом
	 * обращении к $.MC().
	 */
	static init() {
		return MC._bootstrap();
	}

	/**
	 * Внутренняя инициализация — создаёт singleton, патчит jQuery,
	 * включает DOM observer. Идемпотентна.
	 * @returns {boolean} true если инициализация выполнена, false если уже была
	 */
	static _bootstrap() {
		// Уже инициализирован
		if (this.mc) {
			return false;
		}

		// jQuery ещё не загружен
		if (typeof window === 'undefined' || !window.$) {
			return false;
		}

		this.mc = new MC();
		this.mc._isMCRootInstance = true;
		_mc_instance_restore_object.instance = this.mc;

		// Публичный API на jQuery
		window.$.MC = this.mc.use.bind(this);
		window.$.MC.memo = this.mc.useMemo.bind(this);
		window.$.MC.effect = this.mc.useEffect.bind(this);
		window.$.MC.deferredEffect = this.mc.useDeferredEffect.bind(this);
		window.iMC = this.mc;
		window.iMC.mc = this;

		this.mc.log.info('MC инициализирован', [
			`Версия: 8.1`,
			`jQuery: ${(window.$.fn && window.$.fn.jquery) || 'unknown'}`,
			`debugMode: ${MC.debugMode}`,
		]);

		// =================== Патч jQuery event binding ===================
		// Перехватываем $.fn.on (jQuery 1.7+) или $.fn.bind (jQuery 1.0+).
		// ВАЖНО: оригинальный jQuery-метод ВСЕГДА вызывается — мы только
		// дополнительно трекаем обработчики в __mcEvents / __mcBound,
		// чтобы EventDiff мог сравнивать и патчить события при diffing.
		// Обычный jQuery-код работает без изменений.

		const $ = window.$;
		const _eventMethodName = $.fn.on ? 'on' : $.fn.bind ? 'bind' : null;

		if (_eventMethodName) {
			const _origEventMethod = $.fn[_eventMethodName];

			$.fn[_eventMethodName] = function (type, selector, data, fn) {
				// Определяем handler из перегрузок jQuery
				let handler;

				if (typeof selector === 'function') {
					handler = selector;
				} else if (typeof data === 'function') {
					handler = data;
				} else if (typeof fn === 'function') {
					handler = fn;
				}

				// Трекинг для MC — только если есть handler, DOM-элемент,
				// и мы НЕ внутри applyEvents (подавление дублирования)
				if (typeof type === 'string' && handler && !_mc_suppress_event_track) {
					for (let i = 0; i < this.length; i++) {
						const el = this[i];
						if (!el || el.nodeType !== 1) continue;

						el.__mcEvents = el.__mcEvents || {};
						el.__mcBound = el.__mcBound || {};
						if (!el.__mcEvents[type]) el.__mcEvents[type] = [];
						if (!el.__mcBound[type]) el.__mcBound[type] = [];

						el.__mcEvents[type].push(handler);
						el.__mcBound[type].push(handler);
					}
				}

				// ВСЕГДА вызываем оригинальный jQuery-метод
				return _origEventMethod.apply(this, arguments);
			};

			// Сохраняем prototype chain
			$.fn[_eventMethodName].prototype = _origEventMethod.prototype;
		}

		this.mc._enableDomObserver();

		// Включаем поддержку $('</>') для фрагментов
		try {
			MC.enableFragmentShortSyntax();
		} catch (_e) {
			// Не критично — можно использовать $(document.createDocumentFragment())
		}

		return true;
	}

	/**
	 * Гарантирует инициализацию перед первым использованием.
	 * Вызывается из use() / useMemo() / useEffect() как lazy-init guard.
	 */
	static _ensureInitialized() {
		if (!this.mc) {
			if (!MC._bootstrap()) {
				// jQuery ещё не загружен — критическая ситуация
				console.error(
					'[MC] jQuery не найден. MC не может инициализироваться.' +
					'\nУбедитесь что jQuery подключён до первого вызова $.MC().'
				);
				return false;
			}
		}
		return true;
	}

	/**
	 * Явный батчинг.
	 * Все state.set() внутри fn будут обработаны одним flush после завершения.
	 * Полезно для случаев, когда set() вызывается из setTimeout / rAF /
	 * другого async-контекста, где отдельные set() могли бы породить
	 * несколько flush-ов.
	 *
	 * @param {Function} fn
	 */
	static batch(fn) {
		const mc = _getRoot();
		if (!mc) {
			fn();
			return;
		}

		const prevSuppress = mc._suppressFlush;
		mc._suppressFlush = true;

		try {
			fn();
		} finally {
			mc._suppressFlush = prevSuppress;

			// Если мы внешний batch — планируем один flush
			if (
				!prevSuppress &&
				mc.listPendingRedrawRequests.size &&
				!mc._batchUpdateScheduled
			) {
				mc._scheduleFlush();
			}
		}
	}

	static enableFragmentShortSyntax() {
		if (
			typeof window === 'undefined' ||
			!window.$ ||
			!window.$.fn ||
			!window.$.fn.init
		) {
			throw new Error(
				'jQuery не найден в window.$ — нельзя включить fragment short-syntax'
			);
		}

		if (window.$.mcInitPatched) return;

		const $ = window.$;
		const oldInit = $.fn.init;

		if (!$.mcOriginalInit) $.mcOriginalInit = oldInit;

		$.fn.init = function (selector, context, root) {
			if (typeof selector === 'string' && selector === '</>') {
				const jq = oldInit.call(this);
				const frag = document.createDocumentFragment();
				jq[0] = frag;
				jq.length = 1;
				jq._isDocumentFragment = true;
				return jq;
			}
			return oldInit.call(this, selector, context, root);
		};

		$.fn.init.prototype = oldInit.prototype;
		$.mcInitPatched = true;
	}

	static disableFragmentShortSyntax() {
		if (typeof window === 'undefined' || !window.$ || !window.$.fn) return;
		const $ = window.$;
		if (!$.mcInitPatched) return;

		if ($.mcOriginalInit) {
			$.fn.init = $.mcOriginalInit;
			$.fn.init.prototype = $.mcOriginalInit.prototype || $.fn;
			delete $.mcOriginalInit;
		}

		delete $.mcInitPatched;
		delete $.mcLogPatched;
	}

	/**
	 * Создаёт уникальное глобальное состояние
	 * @param {*} value значение состояния
	 * @param {string} key ключ
	 * @param {boolean} forceUpdate
	 * @returns {MCState}
	 */
	static uState(value, key, forceUpdate) {
		if (!key) {
			this.mc.log.error('Ошибка генерации ключа', [
				'Не удалось получить ключ для состояния',
			]);
			return;
		}

		const [state] = this.mc.getState(key);

		if (state) {
			forceUpdate && state.set(value);
			return state;
		}

		return this.mc.createState(value, key);
	}

	/**
	 * Создаёт уникальный контекст
	 */
	static uContext(key) {
		if (!key) {
			this.mc.log.error('Ошибка генерации ключа', [
				'Не удалось получить ключ для состояния',
			]);
			return;
		}

		const context = this.mc.getContext(key);
		if (context) return context;
		return this.mc.createContext(key);
	}

	static host(jqOrEl, cbOrRef) {
		if (!jqOrEl) return jqOrEl;

		const el = jqOrEl.jquery
			? jqOrEl[0]
			: jqOrEl.nodeType
				? jqOrEl
				: jqOrEl[0];
		if (!el) return jqOrEl;

		el.__mc_host = true;

		if (cbOrRef !== undefined) {
			return MC.ref(jqOrEl, cbOrRef);
		}
		return jqOrEl;
	}

	static getState(key) {
		const state = [];

		if (!key) {
			this.mc.mc_state_global.forEach((item) => {
				state.push(item);
			});
			return state;
		}

		this.mc.mc_state_global.forEach((item) => {
			if (item.traceKey === key) {
				state.push(item);
			}
		});

		return state;
	}

	static getContext(key) {
		let context;
		this.mc.mc_context_global.forEach((item) => {
			if (item.key === key) context = item;
		});
		return context;
	}

	static ref(jqOrEl, cbOrRef) {
		if (!jqOrEl) return jqOrEl;

		const el = jqOrEl.jquery
			? jqOrEl[0]
			: jqOrEl.nodeType
				? jqOrEl
				: jqOrEl[0];
		if (!el) return jqOrEl;

		if (typeof cbOrRef === 'function') {
			el.__mc_ref_cb = cbOrRef;
			if (el.__mc_ref_obj) delete el.__mc_ref_obj;
			return jqOrEl;
		}

		if (cbOrRef && typeof cbOrRef === 'object') {
			el.__mc_ref_obj = cbOrRef;
			if (el.__mc_ref_cb) delete el.__mc_ref_cb;
			return jqOrEl;
		}

		return jqOrEl;
	}

	// =================== CLEANUP ===================

	scheduleCleanDeadVDOM() {
		if (this._cleaningScheduled) return;

		this._cleaningScheduled = true;

		const run = async () => {
			try {
				await this.checkAllDeadsFunctionsContainers();
				await this.checkAllDeadsClassComponentsContainers();
			} finally {
				this._cleaningScheduled = false;
			}
		};

		if ('requestIdleCallback' in window) {
			requestIdleCallback(run, { timeout: 500 });
		} else {
			setTimeout(run, 200);
		}
	}

	_trackMountRoot(node) {
		if (!node || node.nodeType !== 1) return;

		if (node.isConnected) {
			this.engine.diff.patch.reconnectingVDOM(node);
			return;
		}

		this._pendingMountRoots.add(node);
		this._ensureMountObserver();
	}

	_ensureMountObserver() {
		if (this._mountObserver) return;

		this._mountObserver = new MutationObserver(() => {
			for (const n of Array.from(this._pendingMountRoots)) {
				if (n.isConnected) {
					this.engine.diff.patch.reconnectingVDOM(n);
					this._pendingMountRoots.delete(n);
				}
			}

			if (this._pendingMountRoots.size === 0) {
				this._mountObserver.disconnect();
				this._mountObserver = null;
			}
		});

		this._mountObserver.observe(document.documentElement, {
			childList: true,
			subtree: true,
		});
	}

	_cleanupFunctionContainerByKey(key, force) {
		force = force || false;
		const VDOM = this.fcCollection.get(key);
		if (!VDOM) return;

		if (!force && VDOM.HTML && VDOM.HTML.isConnected) return;

		this.log.debug('Очистка FC', [
			`key: ${key}`,
			`fn: ${VDOM.draw ? VDOM.draw.name || '(anonymous)' : 'unknown'}`,
			`states: ${VDOM.states.size}`,
		]);

		this.fcIdsCollection.delete(VDOM.id);

		for (const [stateId] of VDOM.states) {
			const state = this.getStateID(stateId);
			if (!state) continue;

			for (const entry of state.fcCollection) {
				if (entry.effectKey === key) {
					state.fcCollection.delete(entry);
					break;
				}
			}
		}

		this.fcCollection.delete(key);
	}

	_cleanupComponentByKey(key, force) {
		force = force || false;
		const VDOM = this.componentCollection.get(key);
		if (!VDOM) return;

		if (
			!force &&
			VDOM.HTML &&
			VDOM.HTML.isConnected &&
			VDOM.HTML.tagName !== 'MC'
		) {
			return;
		}

		const compName =
			(VDOM.component && VDOM.component.constructor && VDOM.component.constructor.name) ||
			'Unknown';

		this.log.debug('Очистка компонента', [
			`Компонент: ${compName}`,
			`key: ${key}`,
			`states: ${VDOM.states.size}`,
		]);

		// unmounted lifecycle
		try {
			this._isInLifecycleCallback = true;
			const lifecycleArgs = this.engine.getComponentLifecycleArgs(VDOM);
			VDOM.unmounted?.call(VDOM.component, ...lifecycleArgs);
		} catch (e) {
			this.log.error('Ошибка в unmounted()', [
				`Компонент: ${compName}`,
				`key: ${key}`,
				String(e),
				e.stack || '',
			]);
		} finally {
			this._isInLifecycleCallback = false;
		}

		this.componentIdsCollection.delete(VDOM.id);

		for (const [stateId] of VDOM.states) {
			const state = this.getStateID(stateId);
			if (!state) continue;

			for (const entry of state.virtualCollection) {
				if (entry.effectKey === key) {
					state.virtualCollection.delete(entry);
					break;
				}
			}

			if (state.local && state.virtualCollection.size === 0) {
				this.mc_state_global.delete(state);
				this._stateById.delete(state.id);
			}
		}

		// Очистить эффекты компонента
		const toDeleteEffect = [];
		for (const [ekey, eff] of this.effectCollection) {
			if (eff.parent === VDOM.key) {
				try {
					eff.unmountCaller();
				} catch (e) {
					this.log.error('Ошибка в effect unmount', [
						`Компонент: ${compName}`,
						`Effect key: ${ekey}`,
						String(e),
						e.stack || '',
					]);
				}

				toDeleteEffect.push(ekey);

				// Убрать из очереди отложенных, если ещё не выполнен
				this._pendingDeferredEffects.delete(ekey);

				for (const [stateKey] of eff.states) {
					const st = this.getStateID(stateKey);
					if (!st) continue;

					for (const item of st.effectCollection) {
						if (item.effectKey === ekey) {
							st.effectCollection.delete(item);
						}
					}
				}
			}
		}

		for (const ekey of toDeleteEffect) {
			const effect = this.effectCollection.get(ekey);
			if (effect) {
				this.effectIdsCollection.delete(effect.id);
			}
			this.effectCollection.delete(ekey);
		}

		if (VDOM.HTML?.isConnected && VDOM.HTML.tagName === 'MC') {
			VDOM.HTML.remove();
		}

		this.componentCollection.delete(key);
	}

	// =================== DOM OBSERVER ===================

	_enableDomObserver() {
		if (this._domObserver) return;

		this._domObserver = new MutationObserver((mutations) => {
			if (this._domObserverSuppress > 0) return;

			for (const m of mutations) {
				for (const n of m.addedNodes || []) {
					if (n && n.nodeType === 1) this._obsAddedRoots.add(n);
				}
				for (const n of m.removedNodes || []) {
					if (n && n.nodeType === 1) this._obsRemovedRoots.add(n);
				}
			}

			if (
				!this._obsFlushScheduled &&
				(this._obsAddedRoots.size || this._obsRemovedRoots.size)
			) {
				this._obsFlushScheduled = true;
				queueMicrotask(() => {
					try {
						this._flushDomObserverQueues();
					} finally {
						this._obsFlushScheduled = false;
					}
				});
			}
		});

		this._domObserver.observe(document.documentElement, {
			childList: true,
			subtree: true,
		});
	}

	_flushDomObserverQueues() {
		if (this._obsAddedRoots.size) {
			const added = Array.from(this._obsAddedRoots);
			this._obsAddedRoots.clear();

			for (const root of added) {
				if (!root || !root.isConnected) continue;

				if (root.instanceMC) {
					this.engine.diff.patch.reconnectingVDOM(root);
					continue;
				}

				const walker = document.createTreeWalker(
					root,
					NodeFilter.SHOW_ELEMENT,
					{
						acceptNode: (node) =>
							node.instanceMC
								? NodeFilter.FILTER_ACCEPT
								: NodeFilter.FILTER_SKIP,
					}
				);
				if (walker.nextNode()) {
					this.engine.diff.patch.reconnectingVDOM(root);
				}
			}
		}

		if (this._obsRemovedRoots.size) {
			const removed = Array.from(this._obsRemovedRoots);
			this._obsRemovedRoots.clear();

			for (const root of removed) {
				if (!root || root.isConnected) continue;
				this._cleanupRemovedSubtree(root);
			}
		}

		this.scheduleCleanDeadVDOM();
	}

	_cleanupRemovedSubtree(root) {
		const fnKeys = new Set();
		const compKeys = new Set();

		const collect = (el) => {
			if (!el || !el.instanceMC) return;
			const id = el.instanceMC;

			if (el.instanceMCtype === 'fn') {
				const key = this.fcIdsCollection.get(id);
				if (key) fnKeys.add(key);
			} else if (el.instanceMCtype === 'mc_component') {
				const key = this.componentIdsCollection.get(id);
				if (key) compKeys.add(key);
			}
		};

		if (root.nodeType === 1) collect(root);

		const walker = document.createTreeWalker(
			root,
			NodeFilter.SHOW_ELEMENT,
			{
				acceptNode: (node) =>
					node.instanceMC
						? NodeFilter.FILTER_ACCEPT
						: NodeFilter.FILTER_SKIP,
			}
		);

		let node = walker.nextNode();
		while (node) {
			collect(node);
			node = walker.nextNode();
		}

		for (const key of fnKeys) {
			const vdom = this.fcCollection.get(key);
			if (!vdom) continue;
			if (vdom.HTML && vdom.HTML.isConnected) continue;
			this._cleanupFunctionContainerByKey(key, true);
		}

		for (const key of compKeys) {
			const vdom = this.componentCollection.get(key);
			if (!vdom) continue;
			if (vdom.HTML && vdom.HTML.isConnected) continue;
			this._cleanupComponentByKey(key, true);
		}
	}

	cleanupComponent(key, force) {
		if (!key) return;
		this._cleanupComponentByKey(key, force || false);
	}

	// =================== TREE KEYS ===================

	getTreeKeySeparator() {
		return this.TREE_KEY_SEPARATOR;
	}

	getEffectParentSeparator() {
		return this.EFFECT_PARENT_SEPARATOR;
	}

	joinTreeKeys(parentKey, childKey) {
		if (!parentKey) return childKey;
		if (!childKey) return parentKey;
		return `${parentKey}${this.getTreeKeySeparator()}${childKey}`;
	}

	getTreeDepthFromKey(key) {
		const source = typeof key === 'string' ? key : '';
		if (!source) return 0;
		const separator = this.getTreeKeySeparator();
		return source.split(separator).length - 1;
	}

	buildLocalStateTraceKey(componentKey) {
		return `lcl_state${this.getTreeKeySeparator()}${componentKey}`;
	}

	// =================== RENDERING INSTANCE ===================

	setCurrentRenderingInstance(key) {
		this.currentRenderingInstance.add(key);
	}

	getCurrentRenderingInstance() {
		const root = _getRoot() || this;
		return Array.from(root.currentRenderingInstance).join(
			root.getTreeKeySeparator()
		);
	}

	resetCurrentRenderingInstance() {
		const root = _getRoot() || this;
		root.currentRenderingInstance.clear();
	}

	deleteKeyCurrentRenderingInstance(key) {
		const root = _getRoot() || this;
		root.currentRenderingInstance.delete(key);
	}

	// =================== STATE API ===================

	/**
	 * Пользовательский API для создания локального состояния (в компоненте)
	 */
	state(value) {
		return this.createLocallyState(value, this);
	}

	uuidv4() {
		return '10000000-1000-4000-8000-100000000000'.replace(/[018]/g, (c) =>
			(
				c ^
				(crypto.getRandomValues(new Uint8Array(1))[0] & (15 >> (c / 4)))
			).toString(16)
		);
	}

	getContext(key) {
		let context;
		this.mc_context_global.forEach((item) => {
			if (item.key === key) context = item;
		});
		return context;
	}

	/**
	 * Получить стейт по traceKey
	 */
	getState(key) {
		const state = [];

		if (!key) {
			this.mc_state_global.forEach((item) => {
				state.push(item);
			});
			return state;
		}

		this.mc_state_global.forEach((item) => {
			if (item.traceKey === key) {
				state.push(item);
			}
		});

		return state;
	}

	/**
	 * Получить стейт по id — O(1) через Map
	 */
	getStateID(id) {
		return this._stateById.get(id) || null;
	}

	/**
	 * Регистрация состояния в хранилище
	 */
	_registerState(state) {
		this.mc_state_global.add(state);
		this._stateById.set(state.id, state);
	}

	/**
	 * Удаление состояния из хранилища
	 */
	_unregisterState(state) {
		this.mc_state_global.delete(state);
		this._stateById.delete(state.id);
	}

	/**
	 * Создание глобального состояния
	 */
	createState(value, traceKey) {
		const stateParam = {
			value: value,
			traceKey: traceKey,
			id: this.uuidv4(),
		};

		const state = new MCState(stateParam);
		state.nameProp = traceKey;

		this.engine.registrController(state);
		this._registerState(state);

		this.log.debug('Создано глобальное состояние', [
			`key: ${traceKey}`,
			`id: ${state.id}`,
			`value: ${typeof value === 'object' ? JSON.stringify(value).substring(0, 100) : String(value)}`,
		]);

		return state;
	}

	createContext(key) {
		const contextParam = {
			id: this.uuidv4(),
			key: key,
		};

		const context = new MCcontext(contextParam);
		this.mc_context_global.add(context);
		return context;
	}

	/**
	 * Создание локального состояния компонента
	 */
	createLocallyState(value, component) {
		const stateParam = {
			value: value,
			id: this.uuidv4(),
			localKey: null,
		};

		const state = new MCState(stateParam, component);
		this.engine.registrController(state);

		const root = _getRoot();
		if (root) {
			root._registerState(state);
		}

		return state;
	}

	// =================== TYPE CHECK ===================

	/**
	 * Проверка типа сущности.
	 * Использует instanceof (безопасно при минификации).
	 */
	checkTypeEntity(component) {
		if (component.prototype instanceof MC) {
			return 'mc_component';
		}

		if (typeof component === 'function') {
			return 'function';
		}

		const type = typeof component;
		const display =
			component === null
				? 'null'
				: type === 'object'
					? (component.constructor && component.constructor.name) || 'Object'
					: type;

		this.log.error('Неизвестный тип компонента', [
			`Получено: ${display} (${type})`,
			'Первый аргумент $.MC() должен быть:',
			'  — функция (function container)',
			'  — класс, наследующий MC (class component)',
			'Проверьте что вы передаёте компонент, а не его экземпляр или результат вызова.',
		]);

		return 'error';
	}

	// =================== PROCESS FUNCTION ===================

	processFunction(args) {
		const { component, instruction, key, props, states } =
			this.normalizeArgs(args);

		if (instruction === 'mc_inst_effect' || instruction === 'mc_inst_deferred_effect') {
			const deferred = instruction === 'mc_inst_deferred_effect';
			const effectVirtual = this.getEffectVirtual(component, key);

			if (effectVirtual) {
				if (effectVirtual.parent) {
					effectVirtual.run = component;
				}
				return;
			}

			this.createEffect(component, states, key, deferred);
			return null;
		}

		const virtual = this.getFunctionContainerVirtual(component, key);

		if (!virtual) {
			return this.createFunctionContainer(component, props, states, key);
		}

		if (!virtual.HTML.isConnected) {
			return this.createFunctionContainer(component, props, states, key);
		}

		virtual.props = props;
		return this.workFunctionContainer(
			virtual,
			instruction === 'mc_inst_memo'
		);
	}

	// =================== HASH / KEY ===================

	/**
	 * DJB2 хеш-функция
	 */
	simpleHash(str) {
		let hash = 5381;
		for (let i = 0; i < str.length; i++) {
			hash = (hash << 5) + hash + str.charCodeAt(i);
		}
		return (hash >>> 0).toString(16);
	}

	/**
	 * Генерация ключа из функции и iteratorKey.
	 * Хеш кешируется на самой функции (_mcKeyHash) — без повторного toString().
	 */
	generateComponentKey(virtualFn, iteratorKey) {
		if (!virtualFn._mcKeyHash) {
			const fnString = virtualFn.toString().trim();
			virtualFn._mcKeyHash = this.simpleHash(fnString);
		}
		return virtualFn._mcKeyHash + `${iteratorKey}`;
	}

	// =================== FUNCTION CONTAINERS ===================

	createSignatureFunctionContainer(virtualFn, props, id, iteratorKey) {
		const key = this.generateComponentKey(virtualFn, iteratorKey);

		const virtualElement = {
			draw: virtualFn,
			props,
			key,
			id,
			states: new Map(),
			HTML: new MC_Element().createEmptyElement(),
		};

		this.fcCollection.set(key, virtualElement);
		this.fcIdsCollection.set(id, key);

		return virtualElement;
	}

	createFunctionContainer(component, props, dependency, iteratorKey) {
		iteratorKey = iteratorKey || '';
		const id = this.uuidv4();
		const NativeVirtual = this.createSignatureFunctionContainer(
			component,
			props,
			id,
			iteratorKey
		);

		if (dependency) {
			dependency.map((state) => {
				if (this.isStateLike(state)) {
					state.fcCollection.add({ effectKey: NativeVirtual.key });
					NativeVirtual.states.set(state.id, state.value);
				} else {
					this.log.error('Неверный стейт', [
						'Переданная сигнатура состояния неверна. Проверьте данные которые вы передали в зависимости',
					]);
				}
			});
		}

		if (!dependency || !dependency.length) {
			this.log.error('Ошибка чтения массива состояний', [
				`Структура функционального контейнера:`,
				`${NativeVirtual.draw}`,
				`- требует наличия массива зависимостей!`,
				'Если вам не нужны зависимости в данном компоненте, скорее всего вы нецелесообразно используете функциональные контейнеры.',
			]);
		}

		NativeVirtual.HTML = this.engine.rerender(NativeVirtual);
		NativeVirtual.HTML.instanceMC = NativeVirtual.id;
		NativeVirtual.HTML.instanceMCtype = 'fn';

		return NativeVirtual.HTML;
	}

	workFunctionContainer(virtual, memo) {
		if (!virtual) return null;
		if (memo) return virtual.HTML;
		return this.engine.rerender(virtual);
	}

	getFunctionContainerVirtual(component, iteratorKey) {
		iteratorKey = iteratorKey || '';
		const key = this.generateComponentKey(component, iteratorKey);
		const virtual = this.fcCollection.get(key);
		return virtual || false;
	}

	async checkAllDeadsFunctionsContainers(batchSize) {
		batchSize = batchSize || 100;
		const deadKeys = [];

		for (const [key, VDOM] of this.fcCollection) {
			if (!VDOM.HTML || !VDOM.HTML.isConnected) {
				deadKeys.push(key);
			}
		}

		for (let i = 0; i < deadKeys.length; i += batchSize) {
			const batch = deadKeys.slice(i, i + batchSize);
			for (const key of batch) {
				this._cleanupFunctionContainerByKey(key, true);
			}
			await new Promise((r) => setTimeout(r, 0));
		}
	}

	async checkAllDeadsClassComponentsContainers(batchSize) {
		batchSize = batchSize || 100;
		const deadKeys = [];

		for (const [key, VDOM] of this.componentCollection) {
			if (!VDOM.HTML || !VDOM.HTML?.isConnected) {
				deadKeys.push(key);
			}
		}

		for (let i = 0; i < deadKeys.length; i += batchSize) {
			const batch = deadKeys.slice(i, i + batchSize);
			for (const key of batch) {
				this._cleanupComponentByKey(key, true);
			}
			await new Promise((r) => setTimeout(r, 0));
		}
	}

	// =================== EFFECTS ===================

	createSignatureEffect(virtualFn, id, iteratorKey) {
		const parentKey = this.getCurrentRenderingInstance();
		const effectSeparator = this.getEffectParentSeparator();

		const key = parentKey
			? `${this.generateComponentKey(virtualFn, iteratorKey)}${effectSeparator}${parentKey}`
			: this.generateComponentKey(virtualFn, iteratorKey);

		const virtualElement = {
			run: virtualFn,
			key: key,
			id,
			states: new Map(),
			parent: parentKey ? parentKey : null,
			unmountCaller: () => {},
		};

		this.effectCollection.set(key, virtualElement);
		this.effectIdsCollection.set(id, key);

		return virtualElement;
	}

	createEffect(component, dependency, iteratorKey, deferred) {
		iteratorKey = iteratorKey || '';
		deferred = deferred || false;

		const id = this.uuidv4();
		const NativeVirtual = this.createSignatureEffect(
			component,
			id,
			iteratorKey
		);

		// Маркер отложенного эффекта — используется в _runFlush
		NativeVirtual._deferred = deferred;

		if (dependency) {
			dependency.map((state) => {
				if (this.isStateLike(state)) {
					state.effectCollection.add({
						effectKey: NativeVirtual.key,
					});
					NativeVirtual.states.set(state.id, state.value);
				} else {
					this.log.error('Неверный стейт в зависимостях эффекта', [
						`Effect key: ${NativeVirtual.key}`,
						`Получено: ${typeof state} — ${String(state)}`,
						'Зависимости effect должны быть MCState объектами.',
					]);
				}
			});
		}

		if (!dependency || !dependency.length) {
			if (deferred) {
				// Отложенный mount-only — запустится после завершения flush-цикла
				this.log.debug('Deferred effect (mount-only, отложен)', [
					`key: ${NativeVirtual.key}`,
					`parent: ${NativeVirtual.parent || 'global'}`,
				]);

				this._pendingDeferredEffects.add(NativeVirtual.key);
			} else {
				// Обычный mount-only — запускается синхронно (как всегда)
				this.log.debug('Effect без зависимостей (mount-only)', [
					`key: ${NativeVirtual.key}`,
					`parent: ${NativeVirtual.parent || 'global'}`,
				]);

				try {
					this._isInEffectCallback = true;
					const unmountCallFunction = NativeVirtual.run(
						NativeVirtual.states.values()
					);
					if (unmountCallFunction) {
						NativeVirtual.unmountCaller = unmountCallFunction;
					}
				} catch (e) {
					this.log.error('Ошибка инициализации эффекта', [
						`key: ${NativeVirtual.key}`,
						`parent: ${NativeVirtual.parent || 'global'}`,
						String(e),
						e.stack || '',
					]);
				} finally {
					this._isInEffectCallback = false;
				}
			}
		}
	}

	getEffectVirtual(component, iteratorKey) {
		iteratorKey = iteratorKey || '';
		const key = this.generateComponentKey(component, iteratorKey);
		const parentKey = this.getCurrentRenderingInstance();
		const effectSeparator = this.getEffectParentSeparator();

		let virtual = this.effectCollection.get(key);
		if (!virtual) {
			virtual = this.effectCollection.get(
				`${key}${effectSeparator}${parentKey}`
			);
		}

		return virtual || false;
	}

	// =================== UTILITY ===================

	hashString(str) {
		let hash = 5381;
		for (let i = 0; i < str.length; i++) {
			hash = (hash * 33) ^ str.charCodeAt(i);
		}
		return (hash >>> 0).toString(36);
	}

	generateKeyFromNormalized(normalized) {
		const parts = [];

		if (normalized.component) {
			parts.push(
				`component:${normalized.component.name || normalized.component.toString()}`
			);
		}

		const propKeys = normalized.props
			? Object.keys(normalized.props).sort()
			: [];
		parts.push(`props:${propKeys.join(',')}`);

		const stateKeys = (normalized.states || []).map((state, index) => {
			if (!state) return `state:${index}`;
			return state.traceKey || state.nameProp || state.id || `state:${index}`;
		});
		parts.push(`states:${stateKeys.join('|')}`);

		if (normalized.context) {
			parts.push(
				`context:${normalized.context.key || normalized.context.id || 'anonymous_context'}`
			);
		}

		return this.hashString(parts.join('|'));
	}

	isStateLike(value) {
		return (
			!!value &&
			(value instanceof MCState ||
				(typeof value.get === 'function' &&
					typeof value.set === 'function'))
		);
	}

	/**
	 * Нормализация аргументов use() / memo() / effect().
	 * (Исправлено имя: normilize → normalize)
	 */
	normalizeArgs(args) {
		const normalized = {
			component: null,
			props: {},
			states: [],
			key: undefined,
			context: null,
			instruction: null,
		};

		const argsArray = Array.from(args);
		const isEffectContext = argsArray.includes('mc_inst_effect') || argsArray.includes('mc_inst_deferred_effect');

		for (const arg of args) {
			if (
				(arg && arg.prototype instanceof MC) ||
				(arg && typeof arg === 'function' && !this.isStateLike(arg))
			) {
				if (!normalized.component) {
					normalized.component = arg;
					continue;
				}
			}

			if (this.isStateLike(arg)) {
				if (
					arg.local &&
					!isEffectContext
				) {
					arg.incorrectStateBindError = true;
					this.log.error('Неправильное назначение', [
						'Локальное состояние компонента не может быть привязано к дочерним компонентам.' +
							'\n Привязка приведёт к избыточным ререндерингам и потенциальным непредсказуемым побочным эффектам.' +
							'\n Используйте пропсы или контекстное/глобальное состояние для передачи данных вниз по дереву компонентов.',
						`traceKey:: ${arg.traceKey}`,
					]);
					continue;
				}
				normalized.states.push(arg);
				continue;
			}

			if (
				Array.isArray(arg) &&
				arg.every((item) => this.isStateLike(item))
			) {
				let err = false;
				arg.forEach((state) => {
					if (
						state.local &&
						!isEffectContext
					) {
						err = true;
						state.incorrectStateBindError = true;
						this.log.error('Неправильное назначение', [
							'Локальное состояние компонента не может быть привязано к дочерним компонентам.' +
								'\n Привязка приведёт к избыточным ререндерингам и потенциальным непредсказуемым побочным эффектам.' +
								'\n Используйте пропсы или контекстное/глобальное состояние для передачи данных вниз по дереву компонентов.',
							`traceKey:: ${state.traceKey}`,
						]);
					}
				});

				if (err) continue;
				normalized.states.push(...arg);
				continue;
			}

			if (arg === 'mc_inst_effect' || arg === 'mc_inst_memo' || arg === 'mc_inst_deferred_effect') {
				normalized.instruction = arg;
				continue;
			}

			if (typeof arg === 'string' || typeof arg === 'number') {
				normalized.key = arg;
				continue;
			}

			if (arg instanceof MCcontext) {
				normalized.context = arg;
				continue;
			}

			if (arg != null && typeof arg === 'object') {
				normalized.props = Object.assign({}, arg);
				continue;
			}

			if (arg != null) {
				normalized.props = arg;
			}
		}

		return normalized;
	}

	// =================== PROCESS COMPONENT ===================

	processComponent(args) {
		const normalized = this.normalizeArgs(args);

		normalized.uniquekey = normalized.key
			? normalized.key
			: this.generateKeyFromNormalized(normalized);
		normalized.key = normalized.uniquekey;

		const rndInstance = this.getCurrentRenderingInstance();
		const uniqueKey = this.joinTreeKeys(rndInstance, normalized.key);
		normalized.key = uniqueKey;

		if (this.componentCollection.has(normalized.key)) {
			const virtual = this.componentCollection.get(normalized.key);

			if (!virtual?.HTML || !virtual.HTML.isConnected) {
				this._cleanupComponentByKey(normalized.key, true);
			} else {
				virtual.normalized.props = normalized.props;
				return this.engine.rerender(virtual, 'mc_component');
			}
		}

		const id = this.uuidv4();
		return this.componentHandler.register(normalized, id);
	}

	// =================== PUBLIC API ===================

	use() {
		// Lazy-init guard
		MC._ensureInitialized();

		const root = _getRoot() || this;
		const [component] = arguments;

		if (!component) {
			root.log.error('Пустой компонент', [
				'Первый аргумент $.MC() не может быть null/undefined.',
				'Проверьте что компонент или функция передаётся корректно.',
			]);
			return null;
		}

		const typeEntity = root.checkTypeEntity(component);

		switch (typeEntity) {
			case 'function':
				return root.processFunction(arguments);
			case 'mc_component':
				return root.processComponent(arguments);
			default:
				return null;
		}
	}

	useMemo() {
		MC._ensureInitialized();
		const root = _getRoot() || this;
		if (arguments.length === 2) {
			return root.use.call(this, ...arguments, '', 'mc_inst_memo');
		}
		return root.use.call(this, ...arguments, 'mc_inst_memo');
	}

	useEffect() {
		MC._ensureInitialized();
		const root = _getRoot() || this;
		if (arguments.length === 2) {
			return root.use.call(this, ...arguments, '', 'mc_inst_effect');
		}
		return root.use.call(this, ...arguments, 'mc_inst_effect');
	}

	/**
	 * Отложенный эффект — callback запускается ПОСЛЕ завершения
	 * всего flush-цикла (включая все каскадные re-flush).
	 * 
	 * Гарантии на момент запуска:
	 * — DOM полностью обновлён
	 * — mounted() уже вызван
	 * — refs доступны
	 * 
	 * Семантика зависимостей та же, что у effect:
	 * — без массива или [] — запустится один раз после mount
	 * — [state1, state2] — запустится при изменении любого state
	 * 
	 * @example
	 * $.MC.deferredEffect(() => {
	 *     // DOM уже в финальном состоянии, можно измерять размеры,
	 *     // ставить фокус, инициализировать сторонние библиотеки
	 *     const height = this.containerRef.current.offsetHeight;
	 *     setComputedHeight(height);
	 * }, []);
	 */
	useDeferredEffect() {
		MC._ensureInitialized();
		const root = _getRoot() || this;
		if (arguments.length === 2) {
			return root.use.call(this, ...arguments, '', 'mc_inst_deferred_effect');
		}
		return root.use.call(this, ...arguments, 'mc_inst_deferred_effect');
	}
}

// =================== AUTO-INIT ===================
// MC v8.1: автоматическая инициализация при загрузке скрипта.
// MC.init() по-прежнему работает для обратной совместимости (v7).
(function _mcAutoInit() {
	if (typeof window === 'undefined') return;

	// Попытка 1: jQuery уже загружен
	if (MC._bootstrap()) return;

	// Попытка 2 / 3: ждём DOM, затем polling
	var onReady = function () {
		if (MC._bootstrap()) return;

		// jQuery может подключиться после DOM ready (async/defer скрипт)
		var attempts = 0;
		var timer = setInterval(function () {
			if (MC._bootstrap() || ++attempts > 50) {
				clearInterval(timer);
				if (attempts > 50 && !_mc_instance_restore_object.instance) {
					console.warn(
						'[MC] jQuery не обнаружен в течение 5 секунд после загрузки DOM.\n' +
						'Убедитесь что jQuery подключён, или вызовите MC.init() вручную после его загрузки.'
					);
				}
			}
		}, 100);
	};

	if (document.readyState === 'loading') {
		document.addEventListener('DOMContentLoaded', onReady);
	} else {
		onReady();
	}
})();