/// <reference types="./JQuery.d.ts" />
export {};

declare global {
  // ============================================================================
  // Utils
  // ============================================================================

  type MCKey = string | number;
  type MCRecord = Record<string, unknown>;

  type MCIsAny<T> = 0 extends (1 & T) ? true : false;
  type MCNoAny<T> = MCIsAny<T> extends true ? unknown : T;

  type MCSanitizeObject<T> = T extends object
    ? { [K in keyof T]: MCNoAny<T[K]> }
    : T;

  // ============================================================================
  // Core primitives
  // ============================================================================

  type MCNode = Node;
  type MCCleanup = void | null | undefined | (() => void);

  type MCRenderOutput = JQuery | ArrayLike<MCNode> | null | undefined;

  // ============================================================================
  // State
  // ============================================================================

  class MCState<T = unknown> {
    id: string;
    value: T;
    traceKey?: string | null;
    local?: unknown;

    set(value: T): void;
    get(): T;
  }

  type MCStateTuple<T> = readonly [value: T, setValue: (value: T) => void, state: MCState<T>];

  type MCStatesFromInstance<I> = {
    [K in keyof I as I[K] extends MCState<any> ? (K extends string ? K : never) : never]:
      I[K] extends MCState<infer V> ? MCStateTuple<V> : never;
  };

  // ============================================================================
  // Base component
  // ============================================================================

  abstract class MC<P = unknown, Ctx = unknown> {
    constructor(props?: P, context?: Ctx, uniquekey?: MCKey);

    state<T>(value: T): MCState<T>;

    render(
      states: MCStatesFromInstance<this>,
      props: P,
      vdom?: unknown
    ): MCRenderOutput;
  }

  // ============================================================================
  // Props inference (без JSDoc пользователя)
  // ============================================================================

  /**
   * Главный трюк: достаём тип props из сигнатуры render() у самого класса.
   * В JS, если написано render(_, { a, b }) — TS строит тип {a:any, b:any}.
   */
  type MCPropsFromRender<C> =
    C extends { prototype: { render: (states: any, props: infer P, ...args: any[]) => any } }
      ? P
      : never;

  /**
   * Если вдруг есть generic (TS/или кто-то всё же типизирует) — можно взять отсюда.
   * В чистом JS обычно будет any, поэтому мы это учитываем ниже.
   */
  type MCPropsFromGeneric<C> =
    C extends new (...args: any[]) => MC<infer P, any> ? P : never;

  /**
   * Итоговые props:
   * - если generic не any → берём generic
   * - иначе пытаемся взять из render()
   * - иначе fallback Record<string, unknown>
   */
  type MCPropsOf<C> =
    MCPropsFromGeneric<C> extends infer GP
      ? (MCIsAny<GP> extends true
          ? (MCPropsFromRender<C> extends infer RP
              ? (RP extends never ? MCRecord : MCSanitizeObject<RP>)
              : MCRecord)
          : MCSanitizeObject<GP>)
      : (MCPropsFromRender<C> extends infer RP
          ? (RP extends never ? MCRecord : MCSanitizeObject<RP>)
          : MCRecord);

  // ============================================================================
  // Deps / fn / effect helpers
  // ============================================================================

  type ValuesOfDeps<D extends readonly MCState<any>[]> = {
    [K in keyof D]: D[K] extends MCState<infer T> ? T : unknown;
  };

  type MCIterableTuple<T extends readonly unknown[]> = Iterable<T[number]> & {
    readonly [K in keyof T]: T[K];
  };

  type MCFunctionComponent<P = MCRecord, D extends readonly MCState<any>[] = readonly MCState<any>[]> = (
    values: MCIterableTuple<ValuesOfDeps<D>>,
    props: P
  ) => MCRenderOutput;

  type MCEffectCallback<D extends readonly MCState<any>[] = readonly MCState<any>[]> = (
    values: MCIterableTuple<ValuesOfDeps<D>>,
    options?: unknown
  ) => MCCleanup;

  // ============================================================================
  // $.MC entrypoint (важно: мягкий ctor, чтобы JS-классы матчились)
  // ============================================================================

  type MCComponentClass = new (...args: any[]) => MC<any, any>;
  type MCDeps = readonly MCState<any>[];

  interface MCEffectEntrypoint {
    <D extends MCDeps>(effect: MCEffectCallback<D>, deps: D, key?: MCKey): null;
    (effect: MCEffectCallback<readonly MCState<any>[]>, key?: MCKey): null;
    (effect: unknown, ...args: unknown[]): null;
  }

  interface MCFactory {
    // --- class components ---
    <C extends MCComponentClass>(
      component: C,
      props?: MCPropsOf<C>,
      key?: MCKey
    ): JQuery;

    // deps + props (props третий аргумент)
    <C extends MCComponentClass, D extends MCDeps>(
      component: C,
      deps: D,
      props?: MCPropsOf<C>,
      key?: MCKey
    ): JQuery;

    // props + deps (props второй аргумент)
    <C extends MCComponentClass, D extends MCDeps>(
      component: C,
      props: MCPropsOf<C>,
      deps: D,
      key?: MCKey
    ): JQuery;

    // --- function containers ---
    <P extends MCRecord, D extends MCDeps>(
      component: MCFunctionComponent<P, D>,
      deps: D,
      props?: P,
      key?: MCKey
    ): JQuery;

    <P extends MCRecord, D extends MCDeps>(
      component: MCFunctionComponent<P, D>,
      props: P,
      deps: D,
      key?: MCKey
    ): JQuery;

    // fallback
    (component: unknown, ...args: unknown[]): unknown;

    memo: MCFactory;
    effect: MCEffectEntrypoint;
  }

  interface JQueryStatic {
    MC: MCFactory;
  }
}
