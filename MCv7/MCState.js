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

					const getDepth = (st) => {
						const key = st?.traceKey ?? st?.nameProp ?? '';
						const s = typeof key === 'string' ? key : '';
						// глубина по количеству "_" (у тебя это соответствует вложенности)
						const m = s.match(/_/g);
						return m ? m.length : 0;
					};

					const isGlobal = (st) => !st?.local; // local undefined/null -> глобальное

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

						// 1) Собираем валидные state
						const dirtyStates = [];
						for (let i = 0; i < ids.length; i++) {
							const st = MCInstance.getStateID(ids[i]);
							if (!st || !st.passport) continue;
							dirtyStates.push(st);
						}

						// 2) Упорядочим: глобальные -> локальные (deep-first)
						dirtyStates.sort((a, b) => {
							const ag = isGlobal(a);
							const bg = isGlobal(b);
							if (ag !== bg) return ag ? -1 : 1;

							// локальные: глубже сначала
							if (!ag) {
								const da = getDepth(a);
								const db = getDepth(b);
								if (da !== db) return db - da;
							}

							// стабильность
							const ka = String(a.traceKey ?? a.nameProp ?? '');
							const kb = String(b.traceKey ?? b.nameProp ?? '');
							return ka < kb ? -1 : ka > kb ? 1 : 0;
						});

						// 3) Дедуп по VDOM ключам
						// key -> maxDepth (для порядка diffing)
						const dirtyFC = new Map();
						const dirtyVC = new Map();
						const dirtyEffectKeys = new Set();

						const engine = MCInstance.engine;

						MCInstance._batching = true;
						MCInstance._batchingEffects = true;

						try {
							for (let i = 0; i < dirtyStates.length; i++) {
								const st = dirtyStates[i];
								const depth = getDepth(st);

								// Коммитим значение в passport, но без рендера (batching=true)
								st.passport.value = st.value;

								// FC (function containers): обновляем virtual.states и помечаем VDOM как dirty
								if (st.fcCollection && st.fcCollection.size) {
									st.fcCollection.forEach((item) => {
										const v = MCInstance.fcCollection.get(item.effectKey);
										if (!v) return;

										v.states.set(st.id, st.value);

										const prev = dirtyFC.get(item.effectKey);
										if (prev == null || depth > prev) dirtyFC.set(item.effectKey, depth);
									});
								}

								// VC (components): обновляем virtual.states и помечаем VDOM как dirty
								if (st.virtualCollection && st.virtualCollection.size) {
									st.virtualCollection.forEach((item) => {
										const v = MCInstance.componentCollection.get(item.effectKey);
										if (!v) return;

										v.states.set(st.id, st.value);

										const prev = dirtyVC.get(item.effectKey);
										if (prev == null || depth > prev) dirtyVC.set(item.effectKey, depth);
									});
								}

								// Effects: обновляем eff.states и собираем dirty keys, запуск позже
								if (st.effectCollection && st.effectCollection.size) {
									st.effectCollection.forEach((item) => {
										const eff = MCInstance.effectCollection.get(item.effectKey);
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
							MCInstance._batching = false;
							MCInstance._batchingEffects = false;
						}

						// 4) DOM diff: каждый VDOM ровно один раз
						// FC — порядок не критичен, но сортируем по depth (глубже -> раньше)
						const fcKeys = Array.from(dirtyFC.entries())
							.sort((a, b) => b[1] - a[1])
							.map(([k]) => k);

						for (let i = 0; i < fcKeys.length; i++) {
							const v = MCInstance.fcCollection.get(fcKeys[i]);
							if (!v) continue;
							engine.diffing(v);
						}

						// Components — deep-first (ребёнок -> родитель)
						const vcKeys = Array.from(dirtyVC.entries())
							.sort((a, b) => b[1] - a[1])
							.map(([k]) => k);

						for (let i = 0; i < vcKeys.length; i++) {
							const v = MCInstance.componentCollection.get(vcKeys[i]);
							if (!v) continue;
							engine.diffingComponent(v);
						}

						// 5) Effects после DOM-коммита
						dirtyEffectKeys.forEach((effectKey) => {
							const eff = MCInstance.effectCollection.get(effectKey);
							if (!eff) return;

							const unmountCallFunction = eff.run(engine.getArrayValuesStates(eff), eff.options);

							if (unmountCallFunction) {
								eff.unmountCaller = unmountCallFunction;
							}
						});

						// 6) Если в процессе появились новые set() — прогоняем ещё раз
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
