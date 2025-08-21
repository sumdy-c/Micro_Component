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

	constructor() {
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

		// Счетчик до проверки, для функциональных контейнеров
		this.checkCountClearedFunctionContainers = this.COUNTER_CLEAR;

		/**
		 * Глобальные хранилища состояний
		 */
		this.mc_state_global = new Set();

		/**
		 * Глобальные хранилища контекстов
		 */
		this.mc_context_global = new Set();

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
		// основной контейнер MC
		window.$.MC = this.mc.use.bind(this);
		window.$.MC.memo = this.mc.useMemo.bind(this);
		window.$.MC.effect = this.mc.useEffect.bind(this);
		window.iMC = this.mc;
		window.iMC.mc = this;
		
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

	setCurrentRenderingInstance(key) {
		this.currentRenderingInstance.add(key);
	}

	getCurrentRenderingInstance() {
		return Array.from(this.currentRenderingInstance).join('_');
	}

	resetCurrentRenderingInstance() {
		this.currentRenderingInstance.clear();
	}

	deleteKeyCurrentRenderingInstance(key) {
		this.currentRenderingInstance.delete(key);
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
	 * Получить контекст по ключук
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

		this.mc_state_global.add(state);

		return state;
	}

	/**
	 * Проверка типа сущности
	 */
	checkTypeEntity(component) {
		if (!component.prototype) {
			return 'function';
		}

		if (component.prototype instanceof MC) {
			return 'mc_component';
		}

		this.log.error('Ошибка определения компонента', [
			'Переданные параметры для функции определения не смогли получить сигнатуру компонента',
			'Проверьте правильность создания своих ресурсов',
		]);

		return 'error';
	}

	processFunction(component, param, iteratorKey, instruction) {
		if (instruction === 'effect') {
			if (this.getEffectVirtual(component, iteratorKey)) {
				return;
			}

			this.createEffect(component, param, iteratorKey);
			return null;
		}

		const virtual = this.getFunctionContainerVirtual(component, iteratorKey);

		if (!virtual) {
			return this.createFunctionContainer(component, param, iteratorKey);
		}

		if (!virtual.HTML.isConnected) {
			this.removeDeadFunctionContainer(virtual, param);
			return this.createFunctionContainer(component, param, iteratorKey);
		}

		// сборка мертвых контейнеров
		this.checkAllDeadsFunctionsContainers();

		return this.workFunctionContainer(virtual, instruction === 'memo');
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
	createSignatureFunctionContainer(virtualFn, id, iteratorKey) {
		const key = this.generateComponentKey(virtualFn, iteratorKey);

		const virtualElement = {
			draw: virtualFn,
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
	createFunctionContainer(component, dependency, iteratorKey = '') {
		const id = this.uuidv4();
		const NativeVirtual = this.createSignatureFunctionContainer(component, id, iteratorKey);

		dependency &&
			dependency.map((state) => {
				// Перед выпуском, рассмотри тут instanceof
				if (this.isStateLike(state)) {
					state.fcCollection.add({ effectKey: NativeVirtual.key });
					NativeVirtual.states.set(state.id, state.value);
				} else {
					this.log.error('Неверный стейт', [
						'Переданная сигнатура состояния неверна. Проверьте данные которые вы передали в зависимости',
					]);
				}
			});

		if (dependency && dependency.length) {
			const [firstState] = dependency;
			NativeVirtual.states.set(firstState.id, `reset_state_initial_${this.uuidv4()}`);
			firstState.initial();
		} else {
			this.log.error('Ошибка чтения массива состояний', [
				`Структура функционального контейнера:`,
				`${NativeVirtual.draw}`,
				`- требует наличия массива зависимостей!`,
				'Если вам не нужны зависимости в данном компоненте, скорее всего вы нецелесообразно используете функциональные контейнеры.',
			]);
		}
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

	/**
	 * Удаление мёртвых функциональных контейнеров
	 */
	removeDeadFunctionContainer(virtual, dependency) {
		this.fcCollection.delete(virtual.key);
		this.fcIdsCollection.delete(virtual.id);

		if (dependency) {
			for (const state of dependency) {
				for (const entry of state.fcCollection) {
					if (entry.effectKey === virtual.key) {
						state.fcCollection.delete(entry);
						break;
					}
				}
			}
		}
	}

	/**
	 * Удаление мёртвых классовых компонентов
	 */
	removeDeadComponent(virtual, dependency) {
		this.componentCollection.delete(virtual.key);
		this.componentIdsCollection.delete(virtual.key);

		if (dependency) {
			for (const state of dependency) {
				for (const entry of state.componentCollection) {
					if (entry.effectKey === virtual.key) {
						state.componentCollection.delete(entry);
						break;
					}
				}
			}
		}
	}

	async checkAllDeadsFunctionsContainers() {
		if (this.checkCountClearedFunctionContainers) {
			--this.checkCountClearedFunctionContainers;
			return;
		}

		new Promise(() => {
			for (const VDOM_Object of this.fcCollection) {
				const [key, VDOM] = VDOM_Object;

				if (!VDOM.HTML.isConnected) {
					this.fcIdsCollection.delete(VDOM.id);

					for (const state_Object of VDOM.states) {
						const state = this.getStateID(state_Object[0]);

						for (const entry of state.fcCollection) {
							if (entry.effectKey === key) {
								state.fcCollection.delete(entry);
								break;
							}
						}
					}

					this.fcCollection.delete(key);
				}
			}
		});

		this.checkCountClearedFunctionContainers = this.COUNTER_CLEAR + this.fcCollection.size;
	}

	/**
	 * Создание сигнатуры эффекта
	 */
	createSignatureEffect(virtualFn, id, iteratorKey) {
		const key = this.generateComponentKey(virtualFn, iteratorKey);

		const virtualElement = {
			run: virtualFn,
			key,
			id,
			states: new Map(),
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
				// Перед выпуском, рассмотри тут instanceof
				if (this.isStateLike(state)) {
					state.effectCollection.add({ effectKey: NativeVirtual.key });
					NativeVirtual.states.set(state.id, state.value);
				} else {
					this.log.error('Неверный стейт', [
						'Переданная сигнатура состояния неверна. Проверьте данные которые вы передали в зависимости',
					]);
				}
			});
	}

	getEffectVirtual(component, iteratorKey = '') {
		const key = this.generateComponentKey(component, iteratorKey);
		const virtual = this.effectCollection.get(key);

		if (virtual) {
			return true;
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

		if (normalized.props && Object.keys(normalized.props).length > 0) {
			parts.push(this.serializeForHash(normalized.props));
		}

		if (normalized.states && normalized.states.length > 0) {
			parts.push(this.serializeForHash(normalized.states.map((s) => s.value)));
		}

		if (normalized.context) {
			parts.push(this.serializeForHash(normalized.context));
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

	// нормалайзер: НЕ вынимаем state из props.
	// Но всё же приводим props к простой форме: сортировка ключей и shallow-копия.
	normilizeArgs(args) {
		const normalized = {
			component: null,
			props: {},
			states: [],
			key: undefined,
			context: null,
		};

		for (const arg of args) {
			if (arg && arg.prototype instanceof MC) {
				normalized.component = arg;
				continue;
			}

			if (this.isStateLike(arg)) {
				normalized.states.push(arg);
				continue;
			}

			if (Array.isArray(arg) && arg.every((item) => this.isStateLike(item))) {
				normalized.states.push(...arg);
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
				// shallow copy props (мы не сериализуем значения здесь)
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

		const id = this.uuidv4();

		const rndInstance = this.getCurrentRenderingInstance();

		const uniqueKey = rndInstance ? `${rndInstance}_${normalized.key}` : normalized.key;
		normalized.key = uniqueKey;

		// Поиск существующего компонента
		if (this.componentCollection.has(normalized.key)) {
			const virtual = this.componentCollection.get(normalized.key);
			virtual.normalized.props = normalized.props;

			return this.engine.rerender(virtual, 'mc_component');
		}

		// Создание нового компонента
		return this.componentHandler.register(normalized, id);
	}

	/**
	 * Начало обработки MC
	 */
	use() {
		const [component, param, iteratorKey, instruction] = arguments;
		const typeEntity = this.mc.checkTypeEntity(component);

		switch (typeEntity) {
			case 'function': {
				return this.mc.processFunction(component, param, iteratorKey, instruction);
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
			return this.mc.use.call(this, ...arguments, '', 'memo');
		}

		return this.mc.use.call(this, ...arguments, 'memo');
	}

	useEffect() {
		if (arguments.length === 2) {
			// нужно для добавления аргумента, при отсутствии итератора компонента
			return this.mc.use.call(this, ...arguments, '', 'effect');
		}

		return this.mc.use.call(this, ...arguments, 'effect');
	}
}
