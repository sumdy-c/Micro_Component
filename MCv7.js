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
      // строгое равенство ссылок — считаем, что нет изменений (сохраняем поведение оригинала)
      return;
    }

    // Примитивы: если оба примитива и === — уже отброшено выше, иначе они разные
    const typeA = typeof this.value;
    const typeB = typeof newValue;
    if (
      (this.value === null || typeA !== "object") &&
      (newValue === null || typeB !== "object")
    ) {
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
        const keysA =
          this.value && typeof this.value === "object"
            ? Object.keys(this.value)
            : [];
        const keysB =
          newValue && typeof newValue === "object" ? Object.keys(newValue) : [];
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

    // 3) Если есть паспорт — изменяем
    if (this.passport) {
      this.value = newValue;
      this.passport.value = this.value;

      // инкремент версии и обновление кеша идентификатора
      this._version++;
      this._identityHash = MCState.computeShallowIdentity(newValue);
    }
  }

  /**
   * Возвращает глубокую копию значения состояния.
   */
  get() {
    return MCState.deepClone(this.value);
  }

  /**
   * Форсирует отрисовку для приходящего компонента, без обновления значения его состояния
   */
  initial() {
    this.passport.value = this.value;
  }

  /**
   * Вычисляет лёгкий идентификатор/шеллоу-хеш для значения (для быстрого сравнения больших массивов/объектов)
   * Возвращает строку — «подпись» содержимого (не крипто-хеш).
   */
  static computeShallowIdentity(value) {
    // primitives
    if (value === null) return "null";
    const t = typeof value;
    if (t !== "object") return `p:${t}:${String(value)}`;

    // Date / RegExp
    if (value instanceof Date) return `D:${value.getTime()}`;
    if (value instanceof RegExp) return `R:${value.source}:${value.flags}`;

    // Array: длина + токены для первых/последних элементов
    if (Array.isArray(value)) {
      const len = value.length;
      const TAKE = 8; // сколько элементов взять с начала/конца
      let parts = [`A:${len}`];
      const head = Math.min(TAKE, len);
      for (let i = 0; i < head; i++)
        parts.push(MCState._tokenForShallow(value[i]));
      if (len > TAKE * 2) {
        parts.push("..");
        for (let i = len - TAKE; i < len; i++)
          parts.push(MCState._tokenForShallow(value[i]));
      } else {
        for (let i = head; i < len; i++)
          parts.push(MCState._tokenForShallow(value[i]));
      }
      return parts.join("|");
    }

    // Map / Set
    if (value instanceof Map) {
      const size = value.size;
      let parts = [`M:${size}`];
      let i = 0;
      for (const [k, v] of value) {
        parts.push(
          `${MCState._tokenForShallow(k)}=>${MCState._tokenForShallow(v)}`
        );
        if (++i >= 8) break;
      }
      return parts.join("|");
    }
    if (value instanceof Set) {
      const size = value.size;
      let parts = [`S:${size}`];
      let i = 0;
      for (const it of value) {
        parts.push(MCState._tokenForShallow(it));
        if (++i >= 8) break;
      }
      return parts.join("|");
    }

    // size + первые N ключей и токен для их значений
    const keys = Object.keys(value);
    const len = keys.length;
    const TAKE_KEYS = 12;
    let parts = [`O:${len}`];
    const slice = keys.slice(0, TAKE_KEYS);
    for (const k of slice)
      parts.push(`${k}=${MCState._tokenForShallow(value[k])}`);
    if (len > TAKE_KEYS) parts.push("..");
    return parts.join("|");
  }

  /**
   * Преобразует элемент в маленький токен для shallow-identity
   */
  static _tokenForShallow(v) {
    if (v === null) return "null";
    const t = typeof v;
    if (t === "object") {
      // используем стабильный id по ссылке (WeakMap)
      return `obj#${MCState._getObjectId(v)}`;
    }
    return `${t}:${String(v)}`;
  }

  /**
   * Присваивает стабильный id объекту (WeakMap)
   */
  static _getObjectId(obj) {
    if (obj === null || typeof obj !== "object") return 0;
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
    if (
      typeof a !== "object" ||
      a === null ||
      typeof b !== "object" ||
      b === null
    ) {
      return false;
    }

    // Date
    if (a instanceof Date && b instanceof Date)
      return a.getTime() === b.getTime();
    // RegExp
    if (a instanceof RegExp && b instanceof RegExp)
      return a.source === b.source && a.flags === b.flags;

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
      if (
        typeof x !== "object" ||
        x === null ||
        typeof y !== "object" ||
        y === null
      )
        return false;

      if (x instanceof Date && y instanceof Date)
        return x.getTime() === y.getTime();
      if (x instanceof RegExp && y instanceof RegExp)
        return x.source === y.source && x.flags === y.flags;

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
        if (!Object.prototype.hasOwnProperty.call(y, k) || !eq(x[k], y[k]))
          return false;
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
    if (typeof structuredClone === "function") {
      try {
        return structuredClone(value);
      } catch (e) {
        // fallthrough to fallback
      }
    }

    const seen = new WeakMap();
    function clone(v) {
      if (v === null || typeof v !== "object") return v;

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
      console.error("Ошибка инициализации логирования для ресурсов MC.");
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
    console.groupCollapsed(
      `%c${prefix} ${title}`,
      "color: #ff5959; font-weight: bold;"
    );
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
    console.groupCollapsed(
      `%c${prefix} ${title}`,
      "color: #ff8500; font-weight: bold;"
    );
    for (const consoleText of textArray) {
      console.warn(consoleText);
    }
    console.groupEnd();
  }
}

class MCEngine {
  mc;

  constructor(mc) {
    this.mc = mc;
    this.diff = new MCDiff(this.mc);
  }

  handlerRender(target, fn, path, state) {
    let tree = {};

    if (!path) {
      path = "obj";
    }

    const proxy = new Proxy(target, {
      get: (_, prop) => {
        if (typeof target[prop] != "object") {
          return target[prop];
        }
        if (tree[prop] === undefined) {
          tree[prop] = this.handlerRender(target[prop], fn, `${path}.${prop}`);
        }
        return Reflect.get(...arguments);
      },
      set: (_, prop) => {
        try {
          fn(state, this.mc, this);
          return target[prop];
        } catch (error) {
          console.log(error);
        }
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
    const NEW_HTML =
      this.jqToHtml(JQ_CONTAINER) ?? new MC_Element().createEmptyElement();

    NEW_HTML.instanceMC = VDOM.id;
    NEW_HTML.instanceMCtype = "fn";
    VDOM.HTML = this.diff.start(VDOM.HTML, NEW_HTML);
  }

  /**
   * Формирование состояния реквизита
   */
  formationStates(VDOM) {
    const stateObject = {
      global: [],
      local: [],
    };

    for (const state of VDOM.normalized.states) {
      if (state.incorrectStateBindError) {
        continue;
      }

      if (state.local) {
        stateObject.local.push(state.get());
      } else {
        stateObject.global.push(state.get());
      }
    }

    return stateObject;
  }

  diffingComponent(VDOM) {
    if (this.mc.constructor.name !== "MC") {
      this.mc = this.mc.mc;
    }

    this.mc.setCurrentRenderingInstance(VDOM.key);
    const stateObject = this.formationStates(VDOM);
    const JQ_CONTAINER = VDOM.draw.call(
      VDOM.component,
      stateObject,
      VDOM.normalized.props,
      VDOM
    );
    this.mc.resetCurrentRenderingInstance();
    const NEW_HTML =
      this.jqToHtml(JQ_CONTAINER) ?? new MC_Element().createEmptyElement();

    NEW_HTML.instanceMC = VDOM.id;
    NEW_HTML.instanceMCtype = "mc_component";
    VDOM.HTML = this.diff.start(VDOM.HTML, NEW_HTML);
  }

  /**
   * Обновить ссылку на компонент для дочернего VDOM
   */
  rerender(VDOM, type = "fn") {
    let NEW_HTML = null;

    if (type === "mc_component") {
      if (this.mc.constructor.name !== "MC") {
        this.mc = this.mc.mc;
      }

      this.mc.setCurrentRenderingInstance(VDOM.component.uniquekey);
      const stateObject = this.formationStates(VDOM);
      const JQ_CONTAINER = VDOM.draw.call(
        VDOM.component,
        stateObject,
        VDOM.normalized.props,
        VDOM
      );
      this.mc.deleteKeyCurrentRenderingInstance(VDOM.component.uniquekey);
      NEW_HTML =
        this.jqToHtml(JQ_CONTAINER) ?? new MC_Element().createEmptyElement();
      NEW_HTML.instanceMC = VDOM.id;
      NEW_HTML.instanceMCtype = "mc_component";
      VDOM.HTML = NEW_HTML;
    } else {
      const JQ_CONTAINER = VDOM.draw(
        this.getArrayValuesStates(VDOM),
        VDOM.props
      );
      NEW_HTML =
        this.jqToHtml(JQ_CONTAINER) ?? new MC_Element().createEmptyElement();

      NEW_HTML.instanceMC = VDOM.id;
      NEW_HTML.instanceMCtype = "fn";
      VDOM.HTML = NEW_HTML;
    }

    return VDOM.HTML;
  }

  render(state, mc, engine) {
    const hasFC = Boolean(state.fcCollection.size);
    const hasVC = Boolean(state.virtualCollection.size);
    const hasFX = Boolean(state.effectCollection.size);

    if (hasFC) engine.renderFunctionContainer(state, mc);
    if (hasVC) engine.renderComponentWork(state, mc);
    if (hasFX) engine.runEffectWork(state, mc);

    // 🔹 Планируем очистку мёртвых контейнеров (без блокировки рендера)
    if (mc.constructor.name !== "MC") {
      mc = mc.mc; // если вызов из дочернего контекста
    }
    mc.scheduleCleanDeadVDOM();
  }

  /**
   * Контролируемый рендер для классового компонента
   */
  controlledRender(VDOM, type = "mc_component") {
    if (type === "mc_component") {
      this.diffingComponent(VDOM);
      return;
    }

    this.diffing(VDOM);
  }

  getArrayValuesStates(virtual) {
    return Array.from(virtual.states.values());
  }

  renderFunctionContainer(state, mc) {
    if (mc.constructor.name !== "MC") {
      mc = mc.mc;
    }

    state.fcCollection.forEach((item) => {
      const virtual = mc.fcCollection.get(item.effectKey);
      const value = virtual.states.get(state.id);

      if (value !== state.value) {
        virtual.states.set(state.id, state.value);
        this.diffing(virtual);
      }
    });
  }

  renderComponentWork(state, mc) {
    if (mc.constructor.name !== "MC") {
      mc = mc.mc;
    }

    state.virtualCollection.forEach((item) => {
      const virtual = mc.componentCollection.get(item.effectKey);
      const value = virtual.states.get(state.id);

      if (value !== state.value) {
        virtual.states.set(state.id, state.value);
        this.diffingComponent(virtual);
      }
    });
  }

  runEffectWork(state, mc) {
    if (mc.constructor.name !== "MC") {
      mc = mc.mc;
    }

    state.effectCollection.forEach((item) => {
      const effect = mc.effectCollection.get(item.effectKey);
      const value = effect.states.get(state.id);

      if (value !== state.value) {
        effect.states.set(state.id, state.value);
        effect.run(this.getArrayValuesStates(effect), effect.options);
      }
    });
  }

  registrController(state) {
    const objectVirtualController = {
      value: state.id,
    };

    const passport = this.handlerRender(
      objectVirtualController,
      this.render,
      "",
      state
    );

    state.setPassport(passport);
  }
}

class MC_Element {
  constructor(html) {
    return this.getComponent(html);
  }

  setAttributes(component) {
    component.HTML.setAttribute("style", "height: 0; width: 0; display: none;");
  }

  createEmptyElement() {
    const micro_component = document.createElement("mc");
    micro_component.setAttribute(
      "style",
      "height: 0; width: 0; display: none;"
    );

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
    this.serviceArrtibute.add("mc_rnd_model_controlled");
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
    const oldStyle =
      (oldNode.getAttribute && oldNode.getAttribute("style")) || "";
    const newStyle =
      (newNode.getAttribute && newNode.getAttribute("style")) || "";
    if (oldStyle !== newStyle) {
      return { set: newStyle, ctx };
    }
    return { ctx };
  }

  applyStyles(stylePatch, domNode) {
    if (!stylePatch) return;
    if ("set" in stylePatch) {
      domNode.setAttribute("style", stylePatch.set);
    }
  }
}

// =================== CLASS DIFF ===================
class ClassDiff {
  diffClasses(oldNode, newNode, ctx) {
    // Обработка class атрибута (строка или список)
    const oldClass =
      (oldNode.getAttribute && oldNode.getAttribute("class")) || "";
    const newClass =
      (newNode.getAttribute && newNode.getAttribute("class")) || "";
    if (oldClass !== newClass) {
      return { set: newClass, ctx };
    }
    return { ctx };
  }

  applyClasses(classPatch, domNode) {
    if (!classPatch) return;
    if ("set" in classPatch) {
      domNode.setAttribute("class", classPatch.set);
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
    if (this.mc.constructor.name !== "MC") {
      this.mc = this.mc.mc;
    }

    if (oldNode.instanceMCtype === "fn") {
      const key = oldNode.instanceMC;
      const vdom = this.mc.fcCollection.get(this.mc.fcIdsCollection.get(key));

      if (vdom) {
        vdom.HTML = null;
      }

      if (newNode.instanceMCtype === "fn" && newNode.instanceMC) {
        oldNode.instanceMC = newNode.instanceMC;
      }

      if (!newNode.instanceMC) {
        oldNode.instanceMC = undefined;
      }

      return;
    }

    if (oldNode.instanceMCtype === "mc_component") {
      const key = oldNode.instanceMC;

      const vdom = this.mc.componentCollection.get(
        this.mc.componentIdsCollection.get(key)
      );

      if (vdom) {
        vdom.HTML = null;
      }

      if (newNode.instanceMCtype === "mc_component" && newNode.instanceMC) {
        oldNode.instanceMC = newNode.instanceMC;
      }

      if (!newNode.instanceMC) {
        oldNode.instanceMC = undefined;
      }
    }
  }

  /**
   * Основная функция сравнения двух узлов
   * Возвращает структуру патча ("trace"), содержащую необходимые операции для применения изменений.
   */
  diffNode(oldNode, newNode, ctx) {
    const context = Object.assign({ level: 0, path: "" }, ctx);

    // === Базовые случаи: отсутствие узлов ===
    if (!oldNode && newNode) {
      return { type: "ADD", node: newNode, ctx: context };
    }
    if (oldNode && !newNode) {
      return { type: "REMOVE", ctx: context };
    }
    if (!oldNode && !newNode) {
      return { type: "NONE", ctx: context };
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

    // === Типы узлов ===
    if (oldNode.nodeType !== newNode.nodeType) {
      return { type: "REPLACE", node: newNode, ctx: context };
    }

    // === Текстовые узлы ===
    if (oldNode.nodeType === Node.TEXT_NODE) {
      if (oldNode.textContent !== newNode.textContent) {
        return { type: "TEXT", text: newNode.textContent, ctx: context };
      }
      return { type: "NONE", ctx: context };
    }

    // === Комментарии ===
    if (oldNode.nodeType === Node.COMMENT_NODE) {
      if (oldNode.textContent !== newNode.textContent) {
        return { type: "COMMENT", text: newNode.textContent, ctx: context };
      }
      return { type: "NONE", ctx: context };
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
        return { type: "REPLACE", node: newNode, ctx: context };
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
      const childrenPatch = this.diffChildren(oldNode, newNode, context);

      return {
        type: "UPDATE",
        attrPatch,
        stylePatch,
        classPatch,
        eventPatch,
        childrenPatch,
        ctx: context,
      };
    }

    // === Падение по умолчанию: нераспознанный случай ===
    return { type: "REPLACE", node: newNode, ctx: context };
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
      const path = context.path + "/" + i; // глубина
      childPatches.push(
        this.diffNode(oldChildren[i], newChildren[i], { ...context, path })
      );
    }
    return { type: "CHILDREN", patches: childPatches, ctx: context };
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

      if (el.instanceMCtype === "fn") {
        const key = el.instanceMC;
        const vdom = this.mc.fcCollection.get(this.mc.fcIdsCollection.get(key));

        if (vdom) {
          vdom.HTML = el;
        }
      }

      if (el.instanceMCtype === "mc_component") {
        const key = el.instanceMC;

        if (this.mc.constructor.name !== "MC") {
          this.mc = this.mc.mc;
        }

        const vdom = this.mc.componentCollection.get(
          this.mc.componentIdsCollection.get(key)
        );

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
          return node.instanceMC
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
  }

  /**
   * Применяет патч к DOM-узлу.
   */
  applyPatch(patch, domNode, ctx) {
    if (!patch) {
      return domNode;
    }

    const context = Object.assign({ level: 0, path: "" }, ctx);

    switch (patch.type) {
      case "ADD":
        if (domNode && domNode.parentNode) {
          domNode.parentNode.appendChild(patch.node);
        }
        return patch.node;
      case "REMOVE":
        if (domNode && domNode.parentNode) {
          domNode.parentNode.removeChild(domNode);
          this.reconnectingVDOM(patch.node);
        }
        return null;
      case "REPLACE":
        if (domNode && domNode.parentNode) {
          domNode.parentNode.replaceChild(patch.node, domNode);
          this.reconnectingVDOM(patch.node);
          return patch.node;
        }
        return patch.node;
      case "TEXT": {
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
      case "COMMENT": {
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
      case "UPDATE":
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
      case "CHILDREN":
        this._applyChildren(patch.patches, domNode, context);
        return domNode;
      case "NONE":
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
      if (!child && patch && patch.type === "ADD") {
        this.reconnectingVDOM(patch.node);
        domNode.appendChild(patch.node);
        continue;
      }

      // REMOVE
      if (child && patch && patch.type === "REMOVE") {
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
      if (patch && patch.type === "ADD") {
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
    try {
      const trace = this.master.diffNode(oldNode, newNode, {
        level: 0,
        path: "",
      });
      const node = this.patch.applyPatch(trace, oldNode, {
        level: 0,
        path: "",
      });

      if (globalThis.logOn) {
        console.log(node);
      }

      return node;
    } catch (e) {
      throw e;
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
    const instance = new normalized.component(
      normalized.props,
      normalized.context,
      normalized.uniquekey
    );
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
          this.mc.log.error("Неверный стейт", [
            "Переданная сигнатура состояния неверна. Проверьте данные которые вы передали в зависимости",
          ]);
        }
      }
    }

    this.start(NativeVirtual);

    NativeVirtual.HTML.instanceMC = NativeVirtual.id;
    NativeVirtual.HTML.instanceMCtype = "mc_component";

    return NativeVirtual.HTML;
  }

  start(NativeVirtual) {
    if (this.mc.getCurrentRenderingInstance()) {
      NativeVirtual.HTML = this.mc.engine.rerender(
        NativeVirtual,
        "mc_component"
      );
      return;
    }

    this.mc.engine.controlledRender(NativeVirtual, "mc_component");
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

        const toDeleteEffect = [];

        for (const [key, value] of this.effectCollection) {
          if (value.parent === VDOM.key) {
            toDeleteEffect.push(key);
          }
        }

        for (const key of toDeleteEffect) {
          this.effectCollection.delete(key);
        }

        this.fcCollection.delete(key);
      }

      await new Promise((r) => setTimeout(r, 0));
    }
  }

  async checkAllDeadsClassComponentsContainers(batchSize = 100) {
    const deadKeys = [];

    // 1. Собираем все мёртвые компоненты
    for (const [key, VDOM] of this.componentCollection) {
      if (!VDOM.HTML || !VDOM.HTML?.isConnected) {
        deadKeys.push(key);
      }
    }

    // 2. Удаляем батчами (чтобы не блокировать главный поток)
    for (let i = 0; i < deadKeys.length; i += batchSize) {
      const batch = deadKeys.slice(i, i + batchSize);

      for (const key of batch) {
        const VDOM = this.componentCollection.get(key);
        if (!VDOM) {
          continue;
        }

        // Удаляем ссылки на компонент
        this.componentIdsCollection.delete(VDOM.id);

        // Чистим связи состояний
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
    const key = this.generateComponentKey(virtualFn, iteratorKey);

    const virtualElement = {
      run: virtualFn,
      key,
      id,
      states: new Map(),
      parent: this.getCurrentRenderingInstance(),
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
      NativeVirtual.run(NativeVirtual.states.values());
    }
  }

  getEffectVirtual(component, iteratorKey = "") {
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

    if (normalized.props && Object.keys(normalized.props).length > 0) {
      parts.push(this.serializeForHash(normalized.props));
    }

    if (normalized.states && normalized.states.length > 0) {
      parts.push(this.serializeForHash(normalized.states.map((s) => s.value)));
    }

    if (normalized.context) {
      parts.push(this.serializeForHash(normalized.context));
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

  // нормалайзер: НЕ вынимаем state из props.
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
