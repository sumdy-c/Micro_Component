/// <reference types="./types/mc.d.ts" />
//TODO v8 = batched render / microtask queue;

//MCv7.2
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
	 * Коллекция закреплённых элементов
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
	 * Разрешение на изменение
	 */
	passport;

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
	_identityHash = null; // кеш shallow-хеша/идентификатора содержимого

	/* Статические приватные инструменты для хеширования/идентификации */
	static _objIdMap = new WeakMap();
	static _nextObjId = 1;

	/**
	 * Имя свойства для объекта получения
	 */
	nameProp;

	/**
	 *
	 * @param {Object} stateParam
	 * @param { * } local
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

		// Инициализировать кеш-хеш для начального значения
		this._identityHash = MCState.computeShallowIdentity(value);
		this._version = 1;
	}

	setPassport(passport) {
		this.passport = passport;
	}

	/**
	 * Устанавливает новое значение состояния
	 * @param {*} newValue
	 */
	set(newValue) {
		// 1) Быстрые проверки
		if (newValue === this.value) {
			return;
		}

		// Примитивы: если оба примитива и === — уже отброшено выше, иначе они разные
		const typeA = typeof this.value;
		const typeB = typeof newValue;
		if ((this.value === null || typeA !== 'object') && (newValue === null || typeB !== 'object')) {
			// оба примитива/ null и !== (т.к. !== === попросили ранее) -> различаются, продолжим к назначению
		} else {
			// Оба — объекты/массивы — пробуем быстрый shallow-скан
			let fastEqual = false;

			// Array fast path
			if (Array.isArray(this.value) && Array.isArray(newValue)) {
				if (this.value.length === newValue.length) {
					// быстрый shallow check по === для элементов
					let sameRefElements = true;
					for (let i = 0; i < this.value.length; i++) {
						if (this.value[i] !== newValue[i]) {
							sameRefElements = false;
							break;
						}
					}
					if (sameRefElements) fastEqual = true;
				}
				// для очень больших массивов можно сравнить shallow-хешы
				if (!fastEqual && newValue.length > 500) {
					const hNew = MCState.computeShallowIdentity(newValue);
					if (hNew === this._identityHash) fastEqual = true;
				}
			} else if (!Array.isArray(this.value) && !Array.isArray(newValue)) {
				// оба — plain objects (или специальные объекты). Попробуем быстрый shallow keys/refs
				const keysA = this.value && typeof this.value === 'object' ? Object.keys(this.value) : [];
				const keysB = newValue && typeof newValue === 'object' ? Object.keys(newValue) : [];
				if (keysA.length === keysB.length) {
					let keysSame = true;
					for (let i = 0; i < keysA.length; i++) {
						const k = keysA[i];
						if (!Object.prototype.hasOwnProperty.call(newValue, k) || this.value[k] !== newValue[k]) {
							keysSame = false;
							break;
						}
					}
					if (keysSame) fastEqual = true;
				}
				// если объект большой - можно использовать shallow identity
				if (!fastEqual && keysA.length > 200) {
					const hNew = MCState.computeShallowIdentity(newValue);
					if (hNew === this._identityHash) fastEqual = true;
				}
			}

			if (fastEqual) {
				// shallow определил, что содержимо/ссылки совпадают — считаем равными
				return;
			}
		}

		// 2) В случаях сомнений делаем глубокое сравнение (fallback)
		if (MCState.deepEqual(newValue, this.value)) {
			return;
		}

		if (this.passport) {
			this.value = newValue;

			const MCInstance = _mc_instance_restore_object.instance;

			// чтобы последний set стал последним в очереди
			MCInstance.listPendingRedrawRequests.delete(this.id);
			MCInstance.listPendingRedrawRequests.add(this.id);

			if (!MCInstance._batchUpdateScheduled) {
				MCInstance._batchUpdateScheduled = true;

				queueMicrotask(() => {
					const MCInstance = _mc_instance_restore_object.instance;

					const runFlush = () => {
						const pending = MCInstance.listPendingRedrawRequests;

						let ids = [];
						if (pending) {
							ids = Array.from(pending);
							pending.clear();
						}

						if (!ids.length) {
							MCInstance._batchUpdateScheduled = false;
							return;
						}

						const dirtyEffectKeys = new Set();

						MCInstance._batching = true;
						MCInstance._batchingEffects = true;

						try {
							for (let i = 0; i < ids.length; i++) {
								const st = MCInstance.getStateID(ids[i]);

								if (!st || !st.passport) {
									continue;
								}

								// Собираем эффекты, которые зависят от этого state,
								// и заранее обновляем effect.states, как это делал бы runEffectWork
								if (st.effectCollection && st.effectCollection.size) {
									st.effectCollection.forEach((item) => {
										const eff = MCInstance.effectCollection.get(item.effectKey);
										if (!eff) {
											return;
										}

										const prev = eff.states.get(st.id);
										if (prev !== st.value) {
											eff.states.set(st.id, st.value);
											dirtyEffectKeys.add(item.effectKey);
										}
									});
								}

								// Последний state в батче — единственный, который реально вызовет render()
								if (i === ids.length - 1) {
									MCInstance._batching = false;
								}

								st.passport.value = st.value;
							}
						} finally {
							MCInstance._batching = false;
							MCInstance._batchingEffects = false;
						}

						dirtyEffectKeys.forEach((effectKey) => {
							const eff = MCInstance.effectCollection.get(effectKey);
							if (!eff) {
								return;
							}

							const unmountCallFunction = eff.run(
								MCInstance.engine.getArrayValuesStates(eff),
								eff.options
							);

							if (unmountCallFunction) {
								eff.unmountCaller = unmountCallFunction;
							}
						});

						// Если во время flush/эффектов появились новые set'ы — прогоняем ещё раз
						if (MCInstance.listPendingRedrawRequests.size) {
							queueMicrotask(runFlush);
							return;
						}

						MCInstance._batchUpdateScheduled = false;
					};

					runFlush();
				});
			}
		}
	}

	/**
	 * Возвращает глубокую копию значения состояния.
	 */
	get() {
		return MCState.deepClone(this.value);
	}

	/**
	 * Вычисляет лёгкий идентификатор/шеллоу-хеш для значения (для быстрого сравнения больших массивов/объектов)
	 * Возвращает строку — «подпись» содержимого (не крипто-хеш).
	 */
	static computeShallowIdentity(value) {
		// primitives
		if (value === null) return 'null';
		const t = typeof value;
		if (t !== 'object') return `p:${t}:${String(value)}`;

		// Date / RegExp
		if (value instanceof Date) return `D:${value.getTime()}`;
		if (value instanceof RegExp) return `R:${value.source}:${value.flags}`;

		// Array: длина + токены для первых/последних элементов
		if (Array.isArray(value)) {
			const len = value.length;
			const TAKE = 8; // сколько элементов взять с начала/конца
			let parts = [`A:${len}`];
			const head = Math.min(TAKE, len);
			for (let i = 0; i < head; i++) parts.push(MCState._tokenForShallow(value[i]));
			if (len > TAKE * 2) {
				parts.push('..');
				for (let i = len - TAKE; i < len; i++) parts.push(MCState._tokenForShallow(value[i]));
			} else {
				for (let i = head; i < len; i++) parts.push(MCState._tokenForShallow(value[i]));
			}
			return parts.join('|');
		}

		// Map / Set
		if (value instanceof Map) {
			const size = value.size;
			let parts = [`M:${size}`];
			let i = 0;
			for (const [k, v] of value) {
				parts.push(`${MCState._tokenForShallow(k)}=>${MCState._tokenForShallow(v)}`);
				if (++i >= 8) break;
			}
			return parts.join('|');
		}
		if (value instanceof Set) {
			const size = value.size;
			let parts = [`S:${size}`];
			let i = 0;
			for (const it of value) {
				parts.push(MCState._tokenForShallow(it));
				if (++i >= 8) break;
			}
			return parts.join('|');
		}

		// size + первые N ключей и токен для их значений
		const keys = Object.keys(value);
		const len = keys.length;
		const TAKE_KEYS = 12;
		let parts = [`O:${len}`];
		const slice = keys.slice(0, TAKE_KEYS);
		for (const k of slice) parts.push(`${k}=${MCState._tokenForShallow(value[k])}`);
		if (len > TAKE_KEYS) parts.push('..');
		return parts.join('|');
	}

	/**
	 * Преобразует элемент в маленький токен для shallow-identity
	 */
	static _tokenForShallow(v) {
		if (v === null) return 'null';
		const t = typeof v;
		if (t === 'object') {
			// используем стабильный id по ссылке (WeakMap)
			return `obj#${MCState._getObjectId(v)}`;
		}
		return `${t}:${String(v)}`;
	}

	/**
	 * Присваивает стабильный id объекту (WeakMap)
	 */
	static _getObjectId(obj) {
		if (obj === null || typeof obj !== 'object') return 0;
		let id = MCState._objIdMap.get(obj);
		if (!id) {
			id = MCState._nextObjId++;
			MCState._objIdMap.set(obj, id);
		}
		return id;
	}

	/**
	 * Рекурсивная функция глубокого сравнения двух значений.
	 */
	static deepEqual(a, b) {
		if (a === b) return true;
		if (typeof a !== 'object' || a === null || typeof b !== 'object' || b === null) {
			return false;
		}

		// Date
		if (a instanceof Date && b instanceof Date) return a.getTime() === b.getTime();
		// RegExp
		if (a instanceof RegExp && b instanceof RegExp) return a.source === b.source && a.flags === b.flags;

		// Map
		if (a instanceof Map && b instanceof Map) {
			if (a.size !== b.size) return false;
			for (const [k, v] of a) {
				if (!b.has(k) || !MCState.deepEqual(v, b.get(k))) return false;
			}
			return true;
		}

		// Set
		if (a instanceof Set && b instanceof Set) {
			if (a.size !== b.size) return false;
			for (const ai of a) {
				let found = false;
				for (const bi of b) {
					if (MCState.deepEqual(ai, bi)) {
						found = true;
						break;
					}
				}
				if (!found) return false;
			}
			return true;
		}

		const seen = new WeakMap();
		function eq(x, y) {
			if (x === y) return true;
			if (typeof x !== 'object' || x === null || typeof y !== 'object' || y === null) return false;

			if (x instanceof Date && y instanceof Date) return x.getTime() === y.getTime();
			if (x instanceof RegExp && y instanceof RegExp) return x.source === y.source && x.flags === y.flags;

			if (seen.has(x)) return seen.get(x) === y;
			seen.set(x, y);

			const isArrX = Array.isArray(x),
				isArrY = Array.isArray(y);
			if (isArrX !== isArrY) return false;
			if (isArrX && isArrY) {
				if (x.length !== y.length) return false;
				for (let i = 0; i < x.length; i++) if (!eq(x[i], y[i])) return false;
				return true;
			}

			const keysX = Object.keys(x);
			const keysY = Object.keys(y);
			if (keysX.length !== keysY.length) return false;
			for (let i = 0; i < keysX.length; i++) {
				const k = keysX[i];
				if (!Object.prototype.hasOwnProperty.call(y, k) || !eq(x[k], y[k])) return false;
			}
			return true;
		}

		return eq(a, b);
	}

	/**
	 * Попытается использовать native structuredClone, при ошибке — fallback с поддержкой циклов.
	 */
	static deepClone(value) {
		// native structuredClone (в современных средах — быстрый и корректный)
		if (typeof structuredClone === 'function') {
			try {
				return structuredClone(value);
			} catch (e) {
				// fallthrough to fallback
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
				const key = keys[i];
				out[key] = clone(v[key]);
			}
			return out;
		}

		return clone(value);
	}
}

class MCLog {
	/**
	 * Компонент подключенного логирования
	 */
	component;

	/**
	 * Компонент MC
	 * @param { unknown } component
	 * @returns
	 */
	constructor(component) {
		if (!component) {
			console.error('Ошибка инициализации логирования для ресурсов MC.');
			return;
		}

		this.component = component;
	}

	/**
	 * Лог ошибки для МС
	 * @param { string } title
	 * @param { Array<string> } textArray
	 */
	error(title, textArray) {
		const prefix = `[${this.component.constructor.name}]`;
		console.groupCollapsed(`%c${prefix} ${title}`, 'color: #ff5959; font-weight: bold;');
		for (const consoleText of textArray) {
			console.error(consoleText);
		}
		console.groupEnd();
	}

	/**
	 * Лог предупреждения для МС
	 * @param { string } title
	 * @param { Array<string> } textArray
	 */
	warn(title, textArray) {
		const prefix = `[${this.component.constructor.name}]`;
		console.groupCollapsed(`%c${prefix} ${title}`, 'color: #ff8500; font-weight: bold;');
		for (const consoleText of textArray) {
			console.warn(consoleText);
		}
		console.groupEnd();
	}
}

class MCEngine {
	mc;
	/**
	 * Свойство определения конкуренции
	 */
	competitionСounter;

	constructor(mc) {
		this.mc = mc;
		this.diff = new MCDiff(this.mc);
		this.competitionСounter = false;
		this.count = 0;
	}

	handlerRender(target, fn, path, state) {
		let tree = {};

		if (!path) {
			path = 'obj';
		}

		const proxy = new Proxy(target, {
			get: (_, prop) => {
				if (typeof target[prop] != 'object') {
					return target[prop];
				}
				if (tree[prop] === undefined) {
					tree[prop] = this.handlerRender(target[prop], fn, `${path}.${prop}`);
				}
				return Reflect.get(...arguments);
			},
			set: (target, prop, value) => {
				target[prop] = value;

				let instance = this.mc;
				if (instance.constructor.name !== 'MC') {
					instance = instance.mc;
				}

				if (instance.getCurrentRenderingInstance()) {
					instance.listPendingRedrawRequests.add(state.id);
					return true;
				}

				if (!instance._batching) {
					fn(state, this.mc, this);
				}
				return true;
			},
		});

		return proxy;
	}

	jqToHtml(jqSelector) {
		if (!jqSelector) {
			return null;
		}

		const [html] = jqSelector;

		if (!html) {
			return null;
		}

		return html;
	}

	// injection DOM
	diffing(VDOM) {
		const JQ_CONTAINER = VDOM.draw(this.getArrayValuesStates(VDOM), VDOM.props);
		const NEW_HTML = this.jqToHtml(JQ_CONTAINER) ?? new MC_Element().createEmptyElement();

		NEW_HTML.instanceMC = VDOM.id;
		NEW_HTML.instanceMCtype = 'fn';
		VDOM.HTML = this.diff.start(VDOM.HTML, NEW_HTML);
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

			if (state.local) {
				stateObject[state.nameProp] = [state.get(), (value) => state.set(value), state];
			} else {
				stateObject[state.nameProp] = [state.get(), (value) => state.set(value), state];
			}
		}

		return stateObject;
	}

	diffingComponent(VDOM) {
		if (this.mc.constructor.name !== 'MC') {
			this.mc = this.mc.mc;
		}

		this.mc.setCurrentRenderingInstance(VDOM.key);

		const stateObject = this.formationStates(VDOM);

		const JQ_CONTAINER = VDOM.draw.call(VDOM.component, stateObject, VDOM.normalized.props, VDOM);

		this.mc.resetCurrentRenderingInstance();

		const NEW_HTML = this.jqToHtml(JQ_CONTAINER) ?? new MC_Element().createEmptyElement();
		NEW_HTML.instanceMC = VDOM.id;
		NEW_HTML.instanceMCtype = 'mc_component';
		const prevHTML = VDOM.HTML;

		VDOM.HTML = this.diff.start(VDOM.HTML, NEW_HTML);

		if (VDOM._mountedCalled && VDOM.HTML?.isConnected) {
			if (typeof VDOM.updated === 'function') {
				VDOM.updated.call(VDOM.component, prevHTML, VDOM.HTML, VDOM);
			} else if (typeof VDOM.component.updated === 'function') {
				VDOM.component.updated(VDOM.HTML, VDOM, prevHTML);
			}
		}
	}

	/**
	 * Обновить ссылку на компонент для дочернего VDOMпроход на отложенныe вызовы
	 */
	rerender(VDOM, type = 'fn') {
		let NEW_HTML = null;

		if (type === 'mc_component') {
			if (this.mc.constructor.name !== 'MC') {
				this.mc = this.mc.mc;
			}

			this.mc.setCurrentRenderingInstance(VDOM.component.uniquekey);

			const stateObject = this.formationStates(VDOM);

			const JQ_CONTAINER = VDOM.draw.call(VDOM.component, stateObject, VDOM.normalized.props, VDOM);
			this.mc.deleteKeyCurrentRenderingInstance(VDOM.component.uniquekey);

			NEW_HTML = this.jqToHtml(JQ_CONTAINER) ?? new MC_Element().createEmptyElement();
			NEW_HTML.instanceMC = VDOM.id;
			NEW_HTML.instanceMCtype = 'mc_component';
			VDOM.HTML = NEW_HTML;
		} else {
			const JQ_CONTAINER = VDOM.draw(this.getArrayValuesStates(VDOM), VDOM.props);
			NEW_HTML = this.jqToHtml(JQ_CONTAINER) ?? new MC_Element().createEmptyElement();

			NEW_HTML.instanceMC = VDOM.id;
			NEW_HTML.instanceMCtype = 'fn';
			VDOM.HTML = NEW_HTML;
		}
		return VDOM.HTML;
	}

	render(state, mc, engine) {
		const hasFC = Boolean(state.fcCollection.size);
		const hasVC = Boolean(state.virtualCollection.size);
		const hasFX = Boolean(state.effectCollection.size);

		let root = mc;
		if (root && root.constructor && root.constructor.name !== 'MC') {
			root = root.mc;
		}
		const isBatchingEffects = Boolean(root && root._batchingEffects);

		if (hasFC) {
			engine.renderFunctionContainer(state, mc);
		}
		if (hasVC) {
			engine.renderComponentWork(state, mc);
		}
		if (hasFX && !isBatchingEffects) {
			engine.runEffectWork(state, mc);
		}

		if (root && root.scheduleCleanDeadVDOM) {
			root.scheduleCleanDeadVDOM();
		}
	}

	/**
	 * Контролируемый рендер
	 */
	controlledRender(VDOM, type = 'mc_component') {
		if (type === 'mc_component') {
			this.diffingComponent(VDOM);
			return;
		}

		this.diffing(VDOM);
	}

	getArrayValuesStates(virtual) {
		return Array.from(virtual.states.values());
	}

	renderFunctionContainer(state, mc) {
		if (mc.constructor.name !== 'MC') {
			mc = mc.mc;
		}

		state.fcCollection.forEach((item) => {
			const virtual = mc.fcCollection.get(item.effectKey);
			virtual.states.set(state.id, state.value);
			this.diffing(virtual);
		});
	}

	renderComponentWork(state, mc) {
		if (mc.constructor.name !== 'MC') {
			mc = mc.mc;
		}

		state.virtualCollection.forEach((item) => {
			const virtual = mc.componentCollection.get(item.effectKey);

			virtual.states.set(state.id, state.value);
			this.diffingComponent(virtual);
		});
	}

	runEffectWork(state, mc) {
		if (mc.constructor.name !== 'MC') {
			mc = mc.mc;
		}

		state.effectCollection.forEach((item) => {
			const effect = mc.effectCollection.get(item.effectKey);

			effect.states.set(state.id, state.value);

			const unmountCallFunction = effect.run(this.getArrayValuesStates(effect), effect.options);

			if (unmountCallFunction) {
				effect.unmountCaller = unmountCallFunction;
			}
		});
	}

	registrController(state) {
		const objectVirtualController = {
			value: state.id,
		};

		const passport = this.handlerRender(objectVirtualController, this.render, '', state);

		state.setPassport(passport);
	}
}

class MC_Element {
	constructor(html) {
		return this.getComponent(html);
	}

	setAttributes(component) {
		component.HTML.setAttribute('style', 'height: 0; width: 0; display: none;');
	}

	createEmptyElement() {
		const micro_component = document.createElement('mc');
		micro_component.setAttribute('style', 'height: 0; width: 0; display: none;');

		return micro_component;
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

class MC_Component {
	/**
	 * Ссылка на MC
	 */
	mc;

	constructor(mc) {
		this.mc = mc;
	}

	createNewInstance(normalized) {
		const instance = new normalized.component(normalized.props, normalized.context, normalized.uniquekey);
		instance.mc = this.mc;
		return instance;
	}

	createSignatureComponent(normalized, id) {
		const instance = this.createNewInstance(normalized);
		instance.uniquekey = normalized.uniquekey;
		instance.parentKey = this.mc.getCurrentRenderingInstance();

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
					localState.traceKey = `lcl_state_${normalized.key}`;
					localState.nameProp = prop;
					normalized.states.push(instance[prop]);
				}

				instance.componentCollection.set(normalized.key, virtualElement);
				instance.componentIdsCollection.set(id, normalized.key);
			}
		}

		this.mc.componentCollection.set(normalized.key, virtualElement);
		this.mc.componentIdsCollection.set(id, normalized.key);

		return virtualElement;
	}

	register(normalized, id) {
		const NativeVirtual = this.createSignatureComponent(normalized, id);

		if (normalized.states.length) {
			for (const state of normalized.states) {
				if (this.mc.isStateLike(state)) {
					state.virtualCollection.add({ effectKey: NativeVirtual.key });
					NativeVirtual.states.set(state.id, state.value);
				} else {
					this.mc.log.error('Неверный стейт', [
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
		if (this.mc.getCurrentRenderingInstance()) {
			NativeVirtual.HTML = this.mc.engine.rerender(NativeVirtual, 'mc_component');
			return;
		}

		this.mc.engine.controlledRender(NativeVirtual, 'mc_component');
	}
}

class MCcontext {
	/**
	 * Идентификтор контекста
	 */
	id;

	/**
	 * Ключ контекста
	 */
	key;

	/**
	 * Коллекция виртуальных элементов
	 */
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

const _mc_instance_restore_object = { instance: null };
/**
 * MCv7
 * Основная сущность для взаимодейтвия MC
 */
class MC {
	/**
	 * Ссылка на оригинальный jq variable
	 */
	original$;

	/**
	 * Активный экземпляр МС
	 */
	mc;

	/**
	 * Список ключей состояний для MC
	 */
	stateList;

	/**
	 * Список состояний
	 */
	mc_state_global;

	/**
	 * Список контекстов
	 */
	mc_context_global;

	/**
	 * Свойство планировщика очистки
	 */
	_cleaningScheduled;

	/**
	 * Коллекция контейнеров
	 */
	fcCollection;

	/**
	 * Коллекция id => fn_key для быстрого получения контейнера по id
	 */
	fcIdsCollection;

	/**
	 * Коллекция компонентов
	 */
	componentCollection;

	/**
	 * Коллекция id => comp_key для быстрого получения компонента по id
	 */
	componentIdsCollection;

	/**
	 * Обработчик компонентов
	 */
	componentHandler;

	/**
	 * Компонент в render
	 */
	currentRenderingInstance;

	/**
	 * Список отложенных запросов на перерисовку
	 */
	listPendingRedrawRequests;

	constructor() {
		this._pendingMountRoots = new Set();
		this._mountObserver = null;
		this.log = new MCLog(this);
		this.engine = new MCEngine(this);
		this.componentHandler = new MC_Component(this);
		this.stateList = new Map();
		/**
		 * Коллекция функциональных контенеров
		 */
		this.fcCollection = new Map();
		this.fcIdsCollection = new Map();
		/**
		 * Коллекция эффектов
		 */
		this.effectCollection = new Map();
		this.effectIdsCollection = new Map();
		/**
		 * Коллекция компонентов
		 */
		this.componentCollection = new Map();
		this.componentIdsCollection = new Map();
		/**
		 * Просмотр потока рендера
		 */
		this.currentRenderingInstance = new Set();

		// константы для счетчиков очистки
		this.COUNTER_CLEAR = 150;

		/**
		 * @deprecated - нужна переработка
		 * Счетчик до проверки, для функциональных контейнеров
		 */
		this.checkCountClearedFunctionContainers = this.COUNTER_CLEAR;

		/**
		 * Глобальные хранилища состояний
		 */
		this.mc_state_global = new Set();

		/**
		 * Глобальные хранилища контекстов
		 */
		this.mc_context_global = new Set();

		/**
		 * Свойство планировщика очистки
		 */
		this._cleaningScheduled = false;

		/**
		 * Список отложенных запросов на перерисовку
		 */
		this.listPendingRedrawRequests = new Set();

		this._batching = false;

		// DOM observer / cleanup
		this._domObserver = null;
		this._domObserverSuppress = 0; // счетчик подавления (на время внутренних diff)
		this._obsRemovedRoots = new Set(); // удалённые корни (кандидаты на cleanup)
		this._obsAddedRoots = new Set(); // добавленные корни (для reconnect/mounted)
		this._obsFlushScheduled = false;

		if (window.$) {
			this.original$ = window.$;
		} else {
			this.log.error('JQuery функция не была обнаружена!', [
				'Для работы MC данного выпуска необходимо подлючение JQuery версии 1.5 или выше',
				'Проверьте подключение библиотеки, либо используйте init после её определения',
			]);
		}
	}

	/**
	 * Первичная инициализация
	 */
	static init() {
		if (this.mc) {
			this.mc.log.warn('На данной странице уже инициализирован Micro Component', [
				'Вы пытаетесь инициализировать MC на странице больше одного раза.',
				'Такое действие не имеет цели для обработчиков МС',
			]);

			this.mc.use();
			return;
		}

		this.mc = new MC();
		_mc_instance_restore_object.instance = this.mc;
		// основной контейнер MC
		window.$.MC = this.mc.use.bind(this);
		window.$.MC.memo = this.mc.useMemo.bind(this);
		window.$.MC.effect = this.mc.useEffect.bind(this);
		window.iMC = this.mc;
		window.iMC.mc = this;

		// Сохраняем оригинальный .on
		const oldOn = window.$.fn.on;

		window.$.fn.on = function (type, selector, data, fn) {
			let handler;

			// Обработка перегрузок jQuery
			if (typeof selector === 'function') {
				handler = selector;
			} else if (typeof fn === 'function') {
				handler = fn;
			} else {
				return oldOn.apply(this, arguments);
			}

			// Берём чистый DOM-узел
			const el = this[0];
			if (el) {
				// Инициализация контейнеров
				el.__mcBound = el.__mcBound || {};
				el.__mcEvents = el.__mcEvents || {};

				// Создаём массив для каждого типа события
				if (!el.__mcBound[type]) el.__mcBound[type] = [];
				if (!el.__mcEvents[type]) el.__mcEvents[type] = [];

				// Сохраняем обработчик
				el.__mcBound[type].push(handler);
				el.__mcEvents[type].push(handler);
			}

			// Вызов оригинального .on
			return oldOn.apply(this, arguments);
		};

		this.mc._enableDomObserver();

		// Активация DF
		// MC.enableFragmentShortSyntax();
	}

	static enableFragmentShortSyntax() {
		if (typeof window === 'undefined' || !window.$ || !window.$.fn || !window.$.fn.init) {
			throw new Error('jQuery не найден в window.$ — нельзя включить fragment short-syntax');
		}

		// Защита от повторного патча
		if (window.$.mcInitPatched) return;

		const $ = window.$;
		const oldInit = $.fn.init;

		// Сохраняем оригинал для отката и внешнего доступа (если понадобится)
		if (!$.mcOriginalInit) $.mcOriginalInit = oldInit;

		// Новый init: перехватываем только точную строку '</>'
		$.fn.init = function (selector, context, root) {
			// если пользователь явно просит '</>' — возвращаем jQuery-обёртку вокруг DocumentFragment
			if (typeof selector === 'string' && selector === '</>') {
				// создаём пустой jQuery-экземпляр через оригинальный init (чтобы все внутренние поля корректно инициализировались)
				// вызов оригинального init без аргументов возвращает пустой jQuery-объект
				const jq = oldInit.call(this);
				const frag = document.createDocumentFragment();
				jq[0] = frag;
				jq.length = 1;
				// сохраним признак, что это фрагмент (удобно для отладки/проверок)
				jq._isDocumentFragment = true;
				return jq;
			}

			// иначе делегируем на оригинальный init (с полным набором аргументов)
			return oldInit.call(this, selector, context, root);
		};

		// сохраняем prototype chain (как делал jQuery)
		$.fn.init.prototype = oldInit.prototype;

		// метки/флаги для безопасности и возможности отката
		$.mcInitPatched = true;
		// при желании можно логировать изменение
		if (!$.mcLogPatched) {
			// не обязательный лог — оставляю молча
			$.mcLogPatched = true;
		}
	}

	/**
	 * Откатит патч и восстановит оригинальный $.fn.init, если мы его сохраняли.
	 */
	static disableFragmentShortSyntax() {
		if (typeof window === 'undefined' || !window.$ || !window.$.fn) return;
		const $ = window.$;
		if (!$.mcInitPatched) return;

		// Восстанавливаем оригинал, если он был сохранён
		if ($.mcOriginalInit) {
			$.fn.init = $.mcOriginalInit;
			$.fn.init.prototype = $.mcOriginalInit.prototype || $.fn;
			delete $.mcOriginalInit;
		}

		delete $.mcInitPatched;
		delete $.mcLogPatched;
	}

	/**
	 * Создаёт уникальное состояние
	 * @param { * } value значение состояния
	 * @param { string } altKey установить свой ключ для состояния
	 * @param { boolean } forceUpdate Если true, БУДЕТ переопределять значение при повторном входе
	 * @returns { MCState } уникальное состояние
	 */
	static uState(value, key, forceUpdate) {
		if (!key) {
			this.mc.log.error('Ошибка генерации ключа', ['Не удалось получить ключ для состояния']);
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
	 * @param {*} value значение состояния
	 * @param {*} key Ключ для поиска состояния
	 * @param {*} notUpdate Если true, не будет переопределять значение при входе
	 * @returns
	 */
	static uContext(key) {
		if (!key) {
			this.mc.log.error('Ошибка генерации ключа', ['Не удалось получить ключ для состояния']);
			return;
		}

		const context = this.mc.getContext(key);

		if (context) {
			return context;
		}

		return this.mc.createContext(key);
	}

	static host(jqOrEl, cbOrRef) {
		if (!jqOrEl) return jqOrEl;

		const el = jqOrEl.jquery ? jqOrEl[0] : jqOrEl.nodeType ? jqOrEl : jqOrEl[0];
		if (!el) return jqOrEl;

		// помечаем как host
		el.__mc_host = true;

		// опционально — ref
		if (cbOrRef !== undefined) {
			return MC.ref(jqOrEl, cbOrRef);
		}

		return jqOrEl;
	}

	/**
	 * Получить стейт по ключу
	 */
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

	/**
	 * Получить контекст по ключу
	 * @param { string } key ключ для получения контекста
	 * @returns
	 */
	static getContext(key) {
		let context;
		this.mc.mc_context_global.forEach((item) => {
			if (item.key === key) {
				context = item;
			}
		});
		return context;
	}

	static ref(jqOrEl, cbOrRef) {
		if (!jqOrEl) return jqOrEl;

		const el = jqOrEl.jquery ? jqOrEl[0] : jqOrEl.nodeType ? jqOrEl : jqOrEl[0];
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

	scheduleCleanDeadVDOM() {
		if (this._cleaningScheduled || this._domObserver) {
			return;
		}

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

		// если уже в DOM — просто сделаем reconnect сразу
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

	_cleanupFunctionContainerByKey(key) {
		const VDOM = this.fcCollection.get(key);
		if (!VDOM) return;

		// если вдруг он уже снова в DOM — не чистим
		if (VDOM.HTML && VDOM.HTML.isConnected) return;

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

	_cleanupComponentByKey(key, force = false) {
		const VDOM = this.componentCollection.get(key);
		if (!VDOM) {
			return;
		}

		if (!force && VDOM.HTML && VDOM.HTML.isConnected) {
			return;
		}

		// unmounted
		try {
			VDOM.unmounted?.call(VDOM.component, VDOM.HTML, VDOM);
		} catch (e) {}

		// удалить привязку id -> key
		this.componentIdsCollection.delete(VDOM.id);

		// очистить подписки состояний на этот компонент
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
			}
		}

		// очистить эффекты компонента
		const toDeleteEffect = [];
		for (const [ekey, eff] of this.effectCollection) {
			if (eff.parent === VDOM.key) {
				try {
					eff.unmountCaller();
				} catch (e) {}

				toDeleteEffect.push(ekey);

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
		for (const ekey of toDeleteEffect) this.effectCollection.delete(ekey);

		// финально удалить VDOM
		this.componentCollection.delete(key);

		// (не обязательно) подчистить ссылку в самом VDOM
		// VDOM.HTML = null;
	}

	_enableDomObserver() {
		if (this._domObserver) return;

		this._domObserver = new MutationObserver((mutations) => {
			// подавляем реакцию на внутренние патчи MC (это главный выигрыш по нагрузке)
			if (this._domObserverSuppress > 0) return;

			for (const m of mutations) {
				// added
				for (const n of m.addedNodes || []) {
					if (n && n.nodeType === 1) this._obsAddedRoots.add(n);
				}
				// removed
				for (const n of m.removedNodes || []) {
					if (n && n.nodeType === 1) this._obsRemovedRoots.add(n);
				}
			}

			if (!this._obsFlushScheduled && (this._obsAddedRoots.size || this._obsRemovedRoots.size)) {
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

		this._domObserver.observe(document.documentElement, { childList: true, subtree: true });
	}

	_flushDomObserverQueues() {
		if (this._obsAddedRoots.size) {
			const added = Array.from(this._obsAddedRoots);
			this._obsAddedRoots.clear();

			for (const root of added) {
				if (!root || !root.isConnected) continue;

				// важный фильтр: не трогать чужие узлы
				// если root сам MC или содержит MC — reconnect
				if (root.instanceMC) {
					this.engine.diff.patch.reconnectingVDOM(root);
					continue;
				}

				const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT, {
					acceptNode: (node) => (node.instanceMC ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_SKIP),
				});
				if (walker.nextNode()) {
					this.engine.diff.patch.reconnectingVDOM(root);
				}
			}
		}

		if (this._obsRemovedRoots.size) {
			const removed = Array.from(this._obsRemovedRoots);
			this._obsRemovedRoots.clear();

			// microtask уже прошёл, поэтому move (remove->add) обычно вернулся и будет isConnected=true
			for (const root of removed) {
				if (!root || root.isConnected) continue; // move or already reattached

				// чистим VDOM только для поддерева root
				this._cleanupRemovedSubtree(root);
			}
		}
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

		// сам root
		if (root.nodeType === 1) collect(root);

		// потомки
		const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT, {
			acceptNode: (node) => (node.instanceMC ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_SKIP),
		});

		let node = walker.nextNode();
		while (node) {
			collect(node);
			node = walker.nextNode();
		}

		// чистим: компоненты и fn независимо
		for (const key of fnKeys) this._cleanupFunctionContainerByKey(key);
		for (const key of compKeys) this._cleanupComponentByKey(key);
	}

	setCurrentRenderingInstance(key) {
		this.currentRenderingInstance.add(key);
	}

	getCurrentRenderingInstance() {
		let instance = this;
		if (instance.constructor.name !== 'MC') {
			instance = this.mc;
		}

		return Array.from(instance.currentRenderingInstance).join('_');
	}

	resetCurrentRenderingInstance() {
		let instance = this;
		if (instance.constructor.name !== 'MC') {
			instance = this.mc;
		}

		instance.currentRenderingInstance.clear();
	}

	deleteKeyCurrentRenderingInstance(key) {
		let instance = this;

		if (instance.constructor.name !== 'MC') {
			instance = this.mc;
		}

		instance.currentRenderingInstance.delete(key);
	}

	/**
	 * Пользовательский api для создания состояния
	 */
	state(value) {
		return this.createLocallyState(value, this);
	}

	/**
	 * Для формирования уникального id
	 */
	uuidv4() {
		return '10000000-1000-4000-8000-100000000000'.replace(/[018]/g, (c) =>
			(c ^ (crypto.getRandomValues(new Uint8Array(1))[0] & (15 >> (c / 4)))).toString(16)
		);
	}

	/**
	 * Получить контекст по ключу
	 * @param { string } key ключ для получения контекста
	 * @returns
	 */
	getContext(key) {
		let context;
		this.mc_context_global.forEach((item) => {
			if (item.key === key) {
				context = item;
			}
		});
		return context;
	}

	/**
	 * Получить стейт по ключу
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
	 * Получить стейт по id
	 */
	getStateID(id) {
		let state = null;
		this.mc_state_global.forEach((item) => {
			if (item.id === id) {
				state = item;
			}
		});

		return state;
	}

	/**
	 * Создание состояния для МС
	 * @param {*} value значение состояния
	 * @returns
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
		this.mc_state_global.add(state);

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
			localKey: null, // записывается при регистрации компонента
		};

		const state = new MCState(stateParam, component);

		this.engine.registrController(state);

		_mc_instance_restore_object.instance.mc_state_global.add(state);

		return state;
	}

	/**
	 * Проверка типа сущности
	 */
	checkTypeEntity(component) {
		if (component.prototype instanceof MC) {
			return 'mc_component';
		}

		if (component.constructor.name === 'Function') {
			return 'function';
		}

		this.log.error('Ошибка определения компонента', [
			'Переданные параметры для функции определения не смогли получить сигнатуру компонента',
			'Проверьте правильность создания своих ресурсов',
		]);

		return 'error';
	}

	processFunction(args) {
		const { component, instruction, key, props, states } = this.normilizeArgs(args);

		if (instruction === 'mc_inst_effect') {
			const effectVirtual = this.getEffectVirtual(component, key);

			if (effectVirtual) {
				if (effectVirtual.parent) {
					// тут надо решить, если Effect без массива состояний
					// возможно стоит проверить на это, и не передавать новый cb (запекание контекста для SingleRndEffect )
					effectVirtual.run = component;
				}

				return;
			}

			this.createEffect(component, states, key);
			return null;
		}

		const virtual = this.getFunctionContainerVirtual(component, key);

		if (!virtual) {
			return this.createFunctionContainer(component, props, states, key);
		}

		if (!virtual.HTML.isConnected) {
			return this.createFunctionContainer(component, props, states, key);
		}

		virtual.props = props; // Обновление реквизита для функционального контейнера
		return this.workFunctionContainer(virtual, instruction === 'mc_inst_memo');
	}

	/**
	 * Простая хеш-функция DJB2 для строки
	 * @param {string} str
	 * @returns {string} хеш в виде строки (hex)
	 */
	simpleHash(str) {
		let hash = 5381;
		for (let i = 0; i < str.length; i++) {
			hash = (hash << 5) + hash + str.charCodeAt(i); // hash * 33 + c
		}
		return (hash >>> 0).toString(16);
	}

	/**
	 * Метод генерации ключа из функции и iteratorKey
	 * @param {Function} virtualFn
	 * @param {string|number} iteratorKey
	 * @returns {string} ключ
	 */
	generateComponentKey(virtualFn, iteratorKey) {
		const fnString = virtualFn.toString().trim();
		const fnHash = this.simpleHash(fnString);
		return fnHash + `${iteratorKey}`;
	}

	/**
	 * Создание сигнатуры для контейнера
	 */
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

	/**
	 * Создание контейнера
	 */
	createFunctionContainer(component, props, dependency, iteratorKey = '') {
		const id = this.uuidv4();
		const NativeVirtual = this.createSignatureFunctionContainer(component, props, id, iteratorKey);

		dependency &&
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

		if (!dependency && !dependency.length) {
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
		if (!virtual) {
			return null;
		}

		if (memo) {
			return virtual.HTML;
		}

		return this.engine.rerender(virtual);
	}

	getFunctionContainerVirtual(component, iteratorKey = '') {
		const key = this.generateComponentKey(component, iteratorKey);

		const virtual = this.fcCollection.get(key);
		if (virtual) {
			return virtual;
		}
		return false;
	}

	async checkAllDeadsFunctionsContainers(batchSize = 100) {
		const deadKeys = [];

		for (const [key, VDOM] of this.fcCollection) {
			if (!VDOM.HTML || !VDOM.HTML.isConnected) {
				deadKeys.push(key);
			}
		}

		for (let i = 0; i < deadKeys.length; i += batchSize) {
			const batch = deadKeys.slice(i, i + batchSize);
			for (const key of batch) {
				const VDOM = this.fcCollection.get(key);
				if (!VDOM) {
					continue;
				}

				this.fcIdsCollection.delete(VDOM.id);

				for (const [stateId] of VDOM.states) {
					const state = this.getStateID(stateId);
					if (!state) {
						continue;
					}

					for (const entry of state.fcCollection) {
						if (entry.effectKey === key) {
							state.fcCollection.delete(entry);
							break;
						}
					}
				}

				this.fcCollection.delete(key);
			}

			await new Promise((r) => setTimeout(r, 0));
		}
	}

	async checkAllDeadsClassComponentsContainers(batchSize = 100) {
		const deadKeys = [];

		for (const [key, VDOM] of this.componentCollection) {
			if (!VDOM.HTML || !VDOM.HTML?.isConnected) {
				deadKeys.push(key);
			}
		}

		for (let i = 0; i < deadKeys.length; i += batchSize) {
			const batch = deadKeys.slice(i, i + batchSize);

			for (const key of batch) {
				const VDOM = this.componentCollection.get(key);
				if (!VDOM) {
					continue;
				}

				this.componentIdsCollection.delete(VDOM.id);

				for (const [stateId] of VDOM.states) {
					const state = this.getStateID(stateId);
					if (!state) {
						continue;
					}

					for (const entry of state.virtualCollection) {
						if (entry.effectKey === key) {
							state.virtualCollection.delete(entry);

							if (state.local && !state.virtualCollection.length) {
								this.mc_state_global.delete(state);
							}
							break;
						}
					}
				}

				const toDeleteEffect = [];

				for (const [key, value] of this.effectCollection) {
					if (value.parent === VDOM.key) {
						value.unmountCaller();
						toDeleteEffect.push(key);

						for (const [stateKey] of value.states) {
							const state = this.getStateID(stateKey);

							if (state) {
								for (const item of state.effectCollection) {
									if (item.effectKey === key) {
										state.effectCollection.delete(item);
									}
								}
							}
						}
					}
				}

				for (const key of toDeleteEffect) {
					this.effectCollection.delete(key);
				}

				this.componentCollection.delete(key);
			}

			// Освободим поток (асинхронная пауза)
			await new Promise((r) => setTimeout(r, 0));
		}
	}

	/**
	 * Создание сигнатуры эффекта
	 */
	createSignatureEffect(virtualFn, id, iteratorKey) {
		const parentKey = this.getCurrentRenderingInstance();

		const key = parentKey
			? `${this.generateComponentKey(virtualFn, iteratorKey)}__${parentKey}`
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

	/**
	 * Создание эффекта МС
	 */
	createEffect(component, dependency, iteratorKey = '') {
		const id = this.uuidv4();
		const NativeVirtual = this.createSignatureEffect(component, id, iteratorKey);

		dependency &&
			dependency.map((state) => {
				if (this.isStateLike(state)) {
					state.effectCollection.add({ effectKey: NativeVirtual.key });
					NativeVirtual.states.set(state.id, state.value);
				} else {
					this.log.error('Неверный стейт', [
						'Переданная сигнатура состояния неверна. Проверьте данные которые вы передали в зависимости',
					]);
				}
			});

		if (!dependency.length) {
			const unmountCallFunction = NativeVirtual.run(NativeVirtual.states.values());

			if (unmountCallFunction) {
				NativeVirtual.unmountCaller = unmountCallFunction;
			}
		}
	}

	getEffectVirtual(component, iteratorKey = '') {
		const key = this.generateComponentKey(component, iteratorKey);
		const parentKey = this.getCurrentRenderingInstance();

		let virtual = null;

		virtual = this.effectCollection.get(key);

		if (!virtual) {
			virtual = this.effectCollection.get(`${key}__${parentKey}`);
		}

		if (virtual) {
			return virtual;
		}

		return false;
	}

	hashString(str) {
		let hash = 5381;
		for (let i = 0; i < str.length; i++) {
			hash = (hash * 33) ^ str.charCodeAt(i);
		}
		return (hash >>> 0).toString(36);
	}

	// Рекурсивная сериализация для хеша
	serializeForHash(value) {
		if (value == null) return 'null';
		if (typeof value === 'string') return `"${value}"`;
		if (typeof value === 'number' || typeof value === 'boolean') return String(value);
		if (Array.isArray(value)) {
			return '[' + value.map((v) => this.serializeForHash(v)).join(',') + ']';
		}
		if (typeof value === 'object') {
			const keys = Object.keys(value).sort();
			return '{' + keys.map((k) => `"${k}":${this.serializeForHash(value[k])}`).join(',') + '}';
		}
		return String(value);
	}

	generateKeyFromNormalized(normalized) {
		const parts = [];

		if (normalized.component) {
			parts.push(normalized.component.name || normalized.component.toString());
		}

		const typeSignature = (value) => {
			const seen = new WeakSet();

			const sig = (v) => {
				if (v === null) return 'null';
				if (v === undefined) return 'undefined';

				const t = typeof v;
				if (t === 'string') return 'string';
				if (t === 'number') return Number.isNaN(v) ? 'nan' : 'number';
				if (t === 'boolean') return 'boolean';
				if (t === 'function') return 'function';
				if (t === 'symbol') return 'symbol';
				if (t === 'bigint') return 'bigint';

				// объекты сложнее
				if (v instanceof Date) return 'Date';
				if (v instanceof RegExp) return 'RegExp';
				if (v instanceof Map) {
					// типы ключей/значений в Map
					const keyTypes = [];
					const valTypes = [];
					for (const [k, val] of v.entries()) {
						keyTypes.push(sig(k));
						valTypes.push(sig(val));
					}
					return `Map<${uniqueSorted(keyTypes).join(',')}|${uniqueSorted(valTypes).join(',')}>`;
				}
				if (v instanceof Set) {
					const elTypes = [];
					for (const el of v.values()) elTypes.push(sig(el));
					return `Set<${uniqueSorted(elTypes).join(',')}>`;
				}
				if (Array.isArray(v)) {
					if (seen.has(v)) return 'Array<...>'; // защита от циклов
					seen.add(v);
					const elemTypes = v.map(sig);
					return `Array<${uniqueSorted(elemTypes).join(',')}>`;
				}
				// Plain object
				if (t === 'object') {
					if (seen.has(v)) return 'Object<...>'; // защита от циклов
					seen.add(v);
					const keys = Object.keys(v).sort();
					// Для каждого ключа берем подпись типа значения — сохраняем имена ключей,
					// потому что обычно они значимы для props. (Если нужно игнорировать имена —
					// можно заменить на uniqueSorted(types) ).
					const pairs = keys.map((k) => `${k}:${sig(v[k])}`);
					return `{${pairs.join(',')}}`;
				}

				// fallback
				return t;
			};

			// helper: уникализировать и отсортировать набор типов (для порядка)
			const uniqueSorted = (arr) => Array.from(new Set(arr)).sort();

			return sig(value);
		};

		if (normalized.props && Object.keys(normalized.props).length > 0) {
			parts.push(typeSignature(normalized.props));
		}

		if (normalized.states && normalized.states.length > 0) {
			// states — массив объектов { value, ... } — учитываем ТОЛЬКО типы value
			parts.push('[' + normalized.states.map((s) => typeSignature(s && s.value)).join('|') + ']');
		}

		if (normalized.context) {
			parts.push(typeSignature(normalized.context));
		}

		return this.hashString(parts.join('|'));
	}

	// проверка, is state-like
	isStateLike(value) {
		return (
			!!value &&
			(value instanceof MCState || (typeof value.get === 'function' && typeof value.set === 'function'))
		);
	}

	// Но всё же приводим props к простой форме: сортировка ключей и shallow-копия.
	normilizeArgs(args) {
		const normalized = {
			component: null,
			props: {},
			states: [],
			key: undefined,
			context: null,
			instruction: null,
		};

		for (const arg of args) {
			if ((arg && arg.prototype instanceof MC) || (arg && arg.constructor.name === 'Function')) {
				normalized.component = arg;
				continue;
			}

			if (this.isStateLike(arg)) {
				if (arg.local && !Array.from(args).includes('mc_inst_effect')) {
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

			if (Array.isArray(arg) && arg.every((item) => this.isStateLike(item))) {
				let err = false;
				arg.forEach((state) => {
					if (state.local && !Array.from(args).includes('mc_inst_effect')) {
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

				if (err) {
					continue;
				}
				normalized.states.push(...arg);
				continue;
			}

			if (arg === 'mc_inst_effect' || arg === 'mc_inst_memo') {
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

			// fallback
			if (arg != null) {
				normalized.props = arg;
			}
		}

		return normalized;
	}

	/**
	 * Компонент МC
	 */
	processComponent(args) {
		// Нормализация аргументов
		const normalized = this.normilizeArgs(args);

		normalized.uniquekey = normalized.key ? normalized.key : this.generateKeyFromNormalized(normalized);
		normalized.key = normalized.uniquekey;

		const rndInstance = this.getCurrentRenderingInstance();

		const uniqueKey = rndInstance ? `${rndInstance}_${normalized.key}` : normalized.key;
		normalized.key = uniqueKey;

		// Поиск существующего компонента
		if (this.componentCollection.has(normalized.key)) {
			const virtual = this.componentCollection.get(normalized.key);
			virtual.normalized.props = normalized.props;

			return this.engine.rerender(virtual, 'mc_component');
		}

		const id = this.uuidv4();

		// Создание нового компонента
		return this.componentHandler.register(normalized, id);
	}

	/**
	 * Начало обработки MC
	 */
	use() {
		const [component] = arguments;
		const typeEntity = this.mc.checkTypeEntity(component);

		switch (typeEntity) {
			case 'function': {
				return this.mc.processFunction(arguments);
			}
			case 'mc_component': {
				return this.mc.processComponent(arguments);
			}
			default:
				return null;
		}
	}

	useMemo() {
		if (arguments.length === 2) {
			// нужно для добавления аргумента, при отсутствии итератора компонента
			return this.mc.use.call(this, ...arguments, '', 'mc_inst_memo');
		}

		return this.mc.use.call(this, ...arguments, 'mc_inst_memo');
	}

	useEffect() {
		if (arguments.length === 2) {
			// нужно для добавления аргумента, при отсутствии итератора компонента
			return this.mc.use.call(this, ...arguments, '', 'mc_inst_effect');
		}

		return this.mc.use.call(this, ...arguments, 'mc_inst_effect');
	}
}