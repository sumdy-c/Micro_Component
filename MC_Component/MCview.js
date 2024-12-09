class MC_Component {
	constructor(html) {
		return this.getComponent(html);
	}

	static createEmptyElement() {
		const micro_component = document.createElement('micro_component');

		micro_component.setAttribute('style', 'height: 0; width: 0; display: none;');
		micro_component.setAttribute('mc', true);

		return micro_component;
	}

	getComponent(HTML) {
		return HTML;
	}
}

class MC_Component_Registration {
	constructor(newComponent) {
		let [ComponentClass, componentArgs, key] = newComponent;

		if (typeof componentArgs === 'string') {
			key = componentArgs;
			componentArgs = null;
		}

		let args = componentArgs;
		if (!componentArgs) {
			args = [
				null,
				{
					context: null,
					props: null,
					states: null,
				},
			];
		}

		MC.keys.push(key);

		return this.register(ComponentClass, args, key);
	}

	register(component, componentArgs, key) {
		const [props, service] = componentArgs;
		if (service.context) {
			const mc_component = new component(service.props, service.context, key);

			const locally_states = [];

			MC.mc_state_global.forEach((item) => {
				if (item.local && item.local === mc_component) {
					locally_states.push(item);
				}
			});

			const id = MC.uuidv4();
			const [virtual, NativeVirtual] = service.context.createVirtual_Component(mc_component, id, key);

			const global_state = [];

			service.states &&
				service.states.map((state) => {
					if (state.__proto__.constructor.name === 'MCState') {
						state.virtualCollection.add(virtual);
						global_state.push(state.value);
					} else {
						console.error('[MC] Ошибка обработки объекта контролёра.');
					}
				});

			const local_state = [];

			locally_states &&
				locally_states.map((state) => {
					if (state.__proto__.constructor.name === 'MCState') {
						state.virtualCollection.add(virtual);
						local_state.push(state.value);
					} else {
						console.error('[MC] Ошибка обработки объекта контролёра.');
					}
				});

			NativeVirtual.props = service.props;
				
			const render_process_component = {
				onDemand: false,
			}

			const render_process_reflection = function(arg_fn) {
				arg_fn(render_process_component);
			}

			const node = mc_component.render(
				{ global: global_state, local: local_state },
				service.props,
				render_process_reflection
			);

			// тут есть render_process_reflection, но при первом вхождении всегда предусмотрен рендер

			if (!node) {
				const micro_component = MC_Component.createEmptyElement();
				NativeVirtual.controller = {
					global: service.states,
					local: locally_states,
				};
				NativeVirtual.HTMLElement = micro_component;
				return micro_component;
			}

			let global_st = service.states ? service.states : [];
			let local_st = locally_states ? locally_states : [];

			if (node.length) {
				node[0].setAttribute('mc', true);
				NativeVirtual.controller = { global: global_st, local: local_st };
				NativeVirtual.HTMLElement = node[0];
				return node[0];
			} else {
				node.setAttribute('mc', true);
				NativeVirtual.controller = { global: global_st, local: local_st };
				NativeVirtual.HTMLElement = node;
				return node;
			}
		} else {
			const mc_component = new component(service.props, service.context, key);

			const locally_states = [];

			MC.mc_state_global.forEach((item) => {
				if (item.local && item.local === mc_component) {
					locally_states.push(item);
				}
			});

			const id = MC.uuidv4();
			const [virtual, NativeVirtual] = MC.createAnonimComponent(mc_component, id, key);

			const global_state = [];
			service.states &&
				service.states.map((state) => {
					if (state.__proto__.constructor.name === 'MCState') {
						state.virtualCollection.add(virtual);
						global_state.push(state.value);
					} else {
						console.error('[MC] Ошибка обработки объекта контролёра.');
					}
				});

			const local_state = [];

			locally_states &&
				locally_states.map((state) => {
					if (state.__proto__.constructor.name === 'MCState') {
						state.virtualCollection.add(virtual);
						local_state.push(state.value);
					} else {
						console.error('[MC] Ошибка обработки объекта контролёра.');
					}
				});

			NativeVirtual.props = service.props;

			let render_process_component = {
				onDemand: false,
			}

			const render_process_reflection = function(arg_fn) {
				arg_fn(render_process_component);
			}

			const node = mc_component.render(
				{ global: global_state, local: local_state },
				service.props,
				render_process_reflection
			);

			// тут есть render_process_reflection, но при первом вхождении всегда предусмотрен рендер

			if (!node) {
				const micro_component = MC_Component.createEmptyElement();
				NativeVirtual.controller = {
					global: service.states,
					local: locally_states,
				};
				NativeVirtual.HTMLElement = micro_component;
				return micro_component;
			}

			let global_st = service.states ? service.states : [];
			let local_st = locally_states ? locally_states : [];

			if (node.length) {
				node[0].setAttribute('mc', true);
				NativeVirtual.controller = { global: global_st, local: local_st };
				NativeVirtual.HTMLElement = node[0];
				return node[0];
			} else {
				node.setAttribute('mc', true);
				NativeVirtual.controller = { global: global_st, local: local_st };
				NativeVirtual.HTMLElement = node;
				return node;
			}
		}
	}
}

/**
 * Предоставляет основной инструмент для манипулирования API Micro Component
 * @returns <micro_component lib 2024>
 */
class MC {
	static keys = [];

	static anonimCollection = new Set();
	static functionCollecton = new Set();

	static mc_state_global = new Set();
	static mc_context_global = new Set();
	static mc_solo_render_global = new Set();
	static mc_demand_render_global = new Set();

	static MC_setting = {
		controlled: false,
	}

	constructor() {
		if (MC._instance) {
			return MC._instance;
		}
	}
	/**
	 * Инициализировать Micro Component
	 * @param MC_setting:
	 * controlled: Позволяет лучше контролировать поток рендеринга, путём запрета отрисовки косвенных компонентов
	 * 
	 * @returns <init API welcome message>
	 */
	static init(MC_setting) {
		var original$ = window.$;

		MC.MC_setting.controlled = MC_setting ? MC_setting.controlled : true;

		/**
		 * Предоставляет основной инструмент для манипулирования API Micro Component
		 * @returns <micro_component lib 2024>
		 */
		window.$.MC = function () {
			if (arguments[0].prototype instanceof MC) {
				if (MCEngine.active) {
					const result = MCEngine.renderChilds_Component(...arguments);
					if (result !== 'nt%Rnd#el') {
						return result;
					}
				}	

				const enter_key = (arg) => {
					if(typeof arg[2] === 'string') {
						return arg[2]
					}

					if(typeof arg[1] === 'string') {
						return arg[1];
					}

					return undefined;
				} 

				if(enter_key(arguments) && MC.keys.includes(enter_key(arguments))) {
					let node;
					const [ _, settingsComponent ] = arguments[1];
					if(!settingsComponent.context) {
						MC.anonimCollection.forEach(virtual => {
							if(virtual.identifier === arguments[2]) {
								const result = MCEngine.renderChilds_Component(...arguments);
								if (result !== 'nt%Rnd#el') {
									node = result;
								}
							}
						});
					} else {
						settingsComponent.context.virtualCollection.forEach(virtual => {
							if(virtual.identifier === arguments[2]) {
								const result = MCEngine.renderChilds_Component(...arguments);
								if (result !== 'nt%Rnd#el') {
									node = result;
								}
							}
						});
					}
					return node;
				}

				return new MC_Component(new MC_Component_Registration(arguments));
			}

			const [arg1, arg2, arg3] = arguments;

			if (typeof arg1 === 'function') {
				let skipEffect = false;
				MC.mc_solo_render_global.forEach(solo_effect => {
					if(solo_effect === arg1.toString()) {
						skipEffect = true;
					}
				});

				if(skipEffect) {
					return;
				}
				
				if(MCEngine.active) {
					const result = MCEngine.renderChilds_FC(arg3, arg1);
					if (result !== 'nt%Rnd#el') {
						return result;
					}
				}

				if (arg3) {
					console.error('MC | ОБРАТИТЕ ВНИМАНИЕ!');
					console.warn('MC | Использование контекста в функциональных контейнерах - устарело! Все функциональные контейнеры перенесены в отдельную область видимости. Удалите контекст и получите доступ с помощью: MC.functionCollecton');
					const id = MC.uuidv4();
					const [virtual, NativeVirtual] = arg3.createVirtual_FC(arg1, id);
					const values = [];
					arg2 &&
						arg2.map((state) => {
							if (state.__proto__.constructor.name === 'MCState') {
								state.virtualCollection.add(virtual);
								values.push(state.value);
							} else {
								console.warn('Не стейт');
							}
						});

					const node = arg1(values);

					if (!node) {
						const micro_component = MC_Component.createEmptyElement();
						NativeVirtual.controller = arg2;
						NativeVirtual.HTMLElement = micro_component;
						return micro_component;
					}

					if (node.length) {
						node[0].setAttribute('mc', true);
						NativeVirtual.controller = arg2;
						NativeVirtual.HTMLElement = node[0];
						return node[0];
					} else {
						node.setAttribute('mc', true);
						NativeVirtual.controller = { global: global_st, local: local_st };
						NativeVirtual.HTMLElement = node;
						return node;
					}
				} else {
					let reNode = undefined;
					MC.functionCollecton.forEach(virtual => {
						if(virtual.Fn && virtual.Fn.toString() === arg1.toString()) {
							const result = MCEngine.renderChilds_FC(arg3, arg1);
							if (result !== 'nt%Rnd#el') {
								reNode = result;
							}
						}
					});

					if(reNode) {
						return reNode;
					}
					
					const creatorAnon = arg1;
					const dependencyAnon = arg2;

					const id = MC.uuidv4();
					const [virtual, NativeVirtual] = MC.createAnonim_FC(creatorAnon, id);
					const arg = [];

					dependencyAnon &&
						dependencyAnon.map((state) => {
							if (state.__proto__.constructor.name === 'MCState') {
								state.virtualCollection.add(virtual);
								arg.push(state.value);
							} else {
								console.warn('Не стейт');
							}
						});
					
					if(!dependencyAnon || !dependencyAnon.length) {
						MC.mc_solo_render_global.add(creatorAnon.toString());
					}

					let render_process = {
						onDemand: false,
					}

					const render_process_reflection = function(arg_fn) {
						arg_fn(render_process);
					}

					const node = creatorAnon(arg, render_process_reflection);

					if(render_process.onDemand) {
						MC.mc_solo_render_global.add(creatorAnon.toString());	
					}

					if (!node) {
						const micro_component = MC_Component.createEmptyElement();
						NativeVirtual.controller = dependencyAnon;
						NativeVirtual.HTMLElement = micro_component;
						return micro_component;
					}

					if (node.length) {
						node[0].setAttribute('mc', true);
						NativeVirtual.controller = dependencyAnon;
						NativeVirtual.HTMLElement = node[0];
						return node[0];
					} else {
						node.setAttribute('mc', true);
						NativeVirtual.controller = dependencyAnon;
						NativeVirtual.HTMLElement = node;
						return node;
					}
				}
			}

			let resultCall = original$.apply(this, arguments);

			return resultCall;
		};

		return 'Добро пожаловать в MC.js!';
	}


	static createAnonim_FC(virtualFn, id) {
		const virtualElement = {
			Fn: virtualFn,
			parent_id: null,
			key: id,
		};

		MC.functionCollecton.add(virtualElement);

		return [{ context: null, id_element: id }, virtualElement];
	}

	static createAnonimComponent(component, id, key) {
		const virtualElement = {
			component: component,
			parent_id: null,
			key: id,
			identifier: key,
		};

		MC.anonimCollection.add(virtualElement);

		return [{ context: null, id_element: id }, virtualElement];
	}

	state(value, key) {
		return MC.createLocallyState(value, key, this);
	}

	/**
	 * Позволяет предоставить реквизит компоненту
	 * @argument { object: states, props, context }
	 * @param states: MCstate[] - предоствлять глобальное состояние
	 * @param props: <any_entity> - предоствлять как обновляемый реквизит
	 * @param context: MCcontext - заколючить компонент в выделенную область видимости
	 */
	static Props(props_object) {
		const props = [];

		const serviceObject = {
			props: null,
			controlled: false,
			context: null,
			states: [],
		};

		for (let prop in props_object) {
			if (!Array.isArray(props_object[prop]) && props_object[prop] instanceof MCcontext) {
				props[2] = { context: props_object[prop] };
				serviceObject.context = props_object[prop];
				continue;
			}

			if (Array.isArray(props_object[prop]) && props_object[prop].every((el) => el instanceof MCState)) {
				props[1] = { states: props_object[prop] };
				serviceObject.states = props_object[prop];
				continue;
			}

			if(prop === 'controlled') {
				serviceObject.controlled = props_object[prop];
			}

			props[0] = { props: props_object[prop] };
			serviceObject.props = props_object[prop];
		}

		return [props, serviceObject];
	}

	static uuidv4() {
		return '10000000-1000-4000-8000-100000000000'.replace(/[018]/g, (c) =>
			(c ^ (crypto.getRandomValues(new Uint8Array(1))[0] & (15 >> (c / 4)))).toString(16)
		);
	}

	/**
	 * Создаёт обычное состояние
	 * @param {*} value значение состояния
	 * @param {*} key Ключ для поиска состояния
	 * @returns 
	 */
	static createState(value, key) {
		const stateParam = {
			value: value,
			key: key,
			id: MC.uuidv4(),
		};

		const state = new MCState(stateParam);

		new MCEngine().registrController(state);

		MC.mc_state_global.add(state);

		return state;
	}

	/**
	 * Создаёт уникальное состояние
	 * @param {*} value значение состояния
	 * @param {*} key Ключ для поиска состояния
	 * @param {*} notUpdate Если true, не будет переопределять значение при входе
	 * @returns 
	 */
	static uState(value, key, notUpdate) {
		if(!key) {
			console.error('[MC] При создании уникального состояния необходимо указывать ключ!');
		}

		const [ state ] = MC.getState(key);

		if(state) {
			if(notUpdate) {
				return state;	
			}
			state.set(value);
			return state;
		}

		return MC.createState(value, key);
	}

	/**
	 * Создаёт уникальный контекст
	 * @param {*} value значение состояния
	 * @param {*} key Ключ для поиска состояния
	 * @param {*} notUpdate Если true, не будет переопределять значение при входе
	 * @returns 
	 */
	static uContext(key) {
		if(!key) {
			console.error('[MC] При создании уникального контекста необходимо указывать ключ!');
		}

		const context = MC.getContext(key);

		if(context) {
			return context;
		}

		return MC.createContext(key);
	}

	static createLocallyState(value, key, component) {
		const stateParam = {
			value: value,
			id: MC.uuidv4(),
			key: key,
		};

		const state = new MCState(stateParam, component);

		new MCEngine().registrController(state);

		MC.mc_state_global.add(state);

		return state;
	}

	static createContext(key) {
		const contextParam = {
			id: MC.uuidv4(),
			key: key,
		};

		const context = new MCcontext(contextParam);

		MC.mc_context_global.add(context);

		return context;
	}

	newKey(count) {
		if (!count) {
			return MC.uuidv4();
		} else {
			const arrKey = [];
			for (let i = 0; i < count; i++) {
				arrKey.push(MC.uuidv4());
			}
			return arrKey;
		}
	}

	static getState(id) {
		const state = [];
		MC.mc_state_global.forEach((item) => {
			if (item.key === id) {
				state.push(item);
			}
		});
		return state;
	}

	static getContext(key) {
		let context;
		MC.mc_context_global.forEach((item) => {
			if (item.key === key) {
				context = item;
			}
		});
		return context;
	}
}