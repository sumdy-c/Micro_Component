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

    if (window.$) {
      this.original$ = window.$;
    } else {
      this.log.error("JQuery функция не была обнаружена!", [
        "Для работы MC данного выпуска необходимо подлючение JQuery версии 1.5 или выше",
        "Проверьте подключение библиотеки, либо используйте init после её определения",
      ]);
    }
  }

  /**
   * Первичная инициализация
   */
  static init() {
    if (this.mc) {
      this.mc.log.warn(
        "На данной странице уже инициализирован Micro Component",
        [
          "Вы пытаетесь инициализировать MC на странице больше одного раза.",
          "Такое действие не имеет цели для обработчиков МС",
        ]
      );

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
      if (typeof selector === "function") {
        handler = selector;
      } else if (typeof fn === "function") {
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

    // Активация DF
    // MC.enableFragmentShortSyntax();
  }

  scheduleCleanDeadVDOM() {
    if (this._cleaningScheduled) {
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

    if ("requestIdleCallback" in window) {
      requestIdleCallback(run, { timeout: 500 });
    } else {
      setTimeout(run, 200);
    }
  }

  static enableFragmentShortSyntax() {
    if (
      typeof window === "undefined" ||
      !window.$ ||
      !window.$.fn ||
      !window.$.fn.init
    ) {
      throw new Error(
        "jQuery не найден в window.$ — нельзя включить fragment short-syntax"
      );
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
      if (typeof selector === "string" && selector === "</>") {
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
    if (typeof window === "undefined" || !window.$ || !window.$.fn) return;
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
      this.mc.log.error("Ошибка генерации ключа", [
        "Не удалось получить ключ для состояния",
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
   * @param {*} value значение состояния
   * @param {*} key Ключ для поиска состояния
   * @param {*} notUpdate Если true, не будет переопределять значение при входе
   * @returns
   */
  static uContext(key) {
    if (!key) {
      this.mc.log.error("Ошибка генерации ключа", [
        "Не удалось получить ключ для состояния",
      ]);
      return;
    }

    const context = this.mc.getContext(key);

    if (context) {
      return context;
    }

    return this.mc.createContext(key);
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

  setCurrentRenderingInstance(key) {
    this.currentRenderingInstance.add(key);
  }

  getCurrentRenderingInstance() {
    return Array.from(this.currentRenderingInstance).join("_");
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
    return "10000000-1000-4000-8000-100000000000".replace(/[018]/g, (c) =>
      (
        c ^
        (crypto.getRandomValues(new Uint8Array(1))[0] & (15 >> (c / 4)))
      ).toString(16)
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
      return "mc_component";
    }

    if (component.constructor.name === "Function") {
      return "function";
    }

    this.log.error("Ошибка определения компонента", [
      "Переданные параметры для функции определения не смогли получить сигнатуру компонента",
      "Проверьте правильность создания своих ресурсов",
    ]);

    return "error";
  }

  processFunction(args) {
    const { component, instruction, key, props, states } =
      this.normilizeArgs(args);

    if (instruction === "effect") {
      if (this.getEffectVirtual(component, key)) {
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
    return this.workFunctionContainer(virtual, instruction === "memo");
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
  createFunctionContainer(component, props, dependency, iteratorKey = "") {
    const id = this.uuidv4();
    const NativeVirtual = this.createSignatureFunctionContainer(
      component,
      props,
      id,
      iteratorKey
    );

    dependency &&
      dependency.map((state) => {
        if (this.isStateLike(state)) {
          state.fcCollection.add({ effectKey: NativeVirtual.key });
          NativeVirtual.states.set(state.id, state.value);
        } else {
          this.log.error("Неверный стейт", [
            "Переданная сигнатура состояния неверна. Проверьте данные которые вы передали в зависимости",
          ]);
        }
      });

    if (!dependency && !dependency.length) {
      this.log.error("Ошибка чтения массива состояний", [
        `Структура функционального контейнера:`,
        `${NativeVirtual.draw}`,
        `- требует наличия массива зависимостей!`,
        "Если вам не нужны зависимости в данном компоненте, скорее всего вы нецелесообразно используете функциональные контейнеры.",
      ]);
    }

    NativeVirtual.HTML = this.engine.rerender(NativeVirtual);
    NativeVirtual.HTML.instanceMC = NativeVirtual.id;
    NativeVirtual.HTML.instanceMCtype = "fn";

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

  getFunctionContainerVirtual(component, iteratorKey = "") {
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

        // v8 = Сейчас эффекты привязываются по инстансу рендера классового компонента, если он есть.
        // Для функциональных контейнеров функционал не предусмотрен
        // Если эффекты будут знать value.parent для функционального контейнера - можно организовать привязку по ним.
        // Но осторожно, нужно не повредить механизм определения детей и привязок для классов!

        // const toDeleteEffect = [];
        // for (const [key, value] of this.effectCollection) {
        //   if (value.parent === VDOM.key) {
        //     value.unmountCaller();
        //     toDeleteEffect.push(key);
        //   }
        // }

        // for (const key of toDeleteEffect) {
        //   this.effectCollection.delete(key);
        // }
        // continue - v8 ?

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
  createEffect(component, dependency, iteratorKey = "") {
    const id = this.uuidv4();
    const NativeVirtual = this.createSignatureEffect(
      component,
      id,
      iteratorKey
    );

    dependency &&
      dependency.map((state) => {
        if (this.isStateLike(state)) {
          state.effectCollection.add({ effectKey: NativeVirtual.key });
          NativeVirtual.states.set(state.id, state.value);
        } else {
          this.log.error("Неверный стейт", [
            "Переданная сигнатура состояния неверна. Проверьте данные которые вы передали в зависимости",
          ]);
        }
      });

    if (!dependency.length) {
      const unmountCallFunction = NativeVirtual.run(
        NativeVirtual.states.values()
      );

      if (unmountCallFunction) {
        NativeVirtual.unmountCaller = unmountCallFunction;
      }
    }
  }

  getEffectVirtual(component, iteratorKey = "") {
    const key = this.generateComponentKey(component, iteratorKey);
    const parentKey = this.getCurrentRenderingInstance();

    let virtual = null;

    virtual = this.effectCollection.get(key);

    if (!virtual) {
      virtual = this.effectCollection.get(`${key}__${parentKey}`);
    }

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
    if (value == null) return "null";
    if (typeof value === "string") return `"${value}"`;
    if (typeof value === "number" || typeof value === "boolean")
      return String(value);
    if (Array.isArray(value)) {
      return "[" + value.map((v) => this.serializeForHash(v)).join(",") + "]";
    }
    if (typeof value === "object") {
      const keys = Object.keys(value).sort();
      return (
        "{" +
        keys.map((k) => `"${k}":${this.serializeForHash(value[k])}`).join(",") +
        "}"
      );
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
        if (v === null) return "null";
        if (v === undefined) return "undefined";

        const t = typeof v;
        if (t === "string") return "string";
        if (t === "number") return Number.isNaN(v) ? "nan" : "number";
        if (t === "boolean") return "boolean";
        if (t === "function") return "function";
        if (t === "symbol") return "symbol";
        if (t === "bigint") return "bigint";

        // объекты сложнее
        if (v instanceof Date) return "Date";
        if (v instanceof RegExp) return "RegExp";
        if (v instanceof Map) {
          // типы ключей/значений в Map
          const keyTypes = [];
          const valTypes = [];
          for (const [k, val] of v.entries()) {
            keyTypes.push(sig(k));
            valTypes.push(sig(val));
          }
          return `Map<${uniqueSorted(keyTypes).join(",")}|${uniqueSorted(
            valTypes
          ).join(",")}>`;
        }
        if (v instanceof Set) {
          const elTypes = [];
          for (const el of v.values()) elTypes.push(sig(el));
          return `Set<${uniqueSorted(elTypes).join(",")}>`;
        }
        if (Array.isArray(v)) {
          if (seen.has(v)) return "Array<...>"; // защита от циклов
          seen.add(v);
          const elemTypes = v.map(sig);
          return `Array<${uniqueSorted(elemTypes).join(",")}>`;
        }
        // Plain object
        if (t === "object") {
          if (seen.has(v)) return "Object<...>"; // защита от циклов
          seen.add(v);
          const keys = Object.keys(v).sort();
          // Для каждого ключа берем подпись типа значения — сохраняем имена ключей,
          // потому что обычно они значимы для props. (Если нужно игнорировать имена —
          // можно заменить на uniqueSorted(types) ).
          const pairs = keys.map((k) => `${k}:${sig(v[k])}`);
          return `{${pairs.join(",")}}`;
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
      parts.push(
        "[" +
          normalized.states.map((s) => typeSignature(s && s.value)).join("|") +
          "]"
      );
    }

    if (normalized.context) {
      parts.push(typeSignature(normalized.context));
    }

    return this.hashString(parts.join("|"));
  }

  // проверка, is state-like
  isStateLike(value) {
    return (
      !!value &&
      (value instanceof MCState ||
        (typeof value.get === "function" && typeof value.set === "function"))
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
      if (
        (arg && arg.prototype instanceof MC) ||
        (arg && arg.constructor.name === "Function")
      ) {
        normalized.component = arg;
        continue;
      }

      if (this.isStateLike(arg)) {
        if (arg.local) {
          arg.incorrectStateBindError = true;

          this.log.error("Неправильное назначение", [
            "Локальное состояние компонента не может быть привязано к дочерним компонентам." +
              "\n Привязка приведёт к избыточным ререндерингам и потенциальным непредсказуемым побочным эффектам." +
              "\n Используйте пропсы или контекстное/глобальное состояние для передачи данных вниз по дереву компонентов.",
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
          if (state.local) {
            err = true;
            state.incorrectStateBindError = true;
            this.log.error("Неправильное назначение", [
              "Локальное состояние компонента не может быть привязано к дочерним компонентам." +
                "\n Привязка приведёт к избыточным ререндерингам и потенциальным непредсказуемым побочным эффектам." +
                "\n Используйте пропсы или контекстное/глобальное состояние для передачи данных вниз по дереву компонентов.",
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

      if (arg === "effect" || arg === "memo") {
        normalized.instruction = arg;
        continue;
      }

      if (typeof arg === "string" || typeof arg === "number") {
        normalized.key = arg;
        continue;
      }

      if (arg instanceof MCcontext) {
        normalized.context = arg;
        continue;
      }

      if (arg != null && typeof arg === "object") {
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

    normalized.uniquekey = normalized.key
      ? normalized.key
      : this.generateKeyFromNormalized(normalized);
    normalized.key = normalized.uniquekey;

    const rndInstance = this.getCurrentRenderingInstance();

    const uniqueKey = rndInstance
      ? `${rndInstance}_${normalized.key}`
      : normalized.key;
    normalized.key = uniqueKey;

    // Поиск существующего компонента
    if (this.componentCollection.has(normalized.key)) {
      const virtual = this.componentCollection.get(normalized.key);
      virtual.normalized.props = normalized.props;

      return this.engine.rerender(virtual, "mc_component");
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
      case "function": {
        return this.mc.processFunction(arguments);
      }
      case "mc_component": {
        return this.mc.processComponent(arguments);
      }
      default:
        return null;
    }
  }

  useMemo() {
    if (arguments.length === 2) {
      // нужно для добавления аргумента, при отсутствии итератора компонента
      return this.mc.use.call(this, ...arguments, "", "memo");
    }

    return this.mc.use.call(this, ...arguments, "memo");
  }

  useEffect() {
    if (arguments.length === 2) {
      // нужно для добавления аргумента, при отсутствии итератора компонента
      return this.mc.use.call(this, ...arguments, "", "effect");
    }

    return this.mc.use.call(this, ...arguments, "effect");
  }
}