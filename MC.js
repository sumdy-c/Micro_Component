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
  
	render() {
	  this.virtualCollection;
	}
  
	/**
	 * Функция создания функционального компонента
	 */
	createVirtual_FC(virtualFn, id) {
	  const virtualElement = {
		Fn: virtualFn,
		parent_id: this.id,
		key: id,
	  };
	  this.virtualCollection.add(virtualElement);
  
	  return [{ context: this.id, id_element: id }, virtualElement];
	}
  
	/**
	 * Функция создания классового компонента
	 */
	createVirtual_Component(component, id, key) {
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
	key;
  
	/**
	 * Коллекция закреплённых элементов
	 */
	virtualCollection;
  
	/**
	 * Разрешение на изменение
	 */
	passport;
  
	/**
	 *
	 * @param {} stateParam
	 */
	constructor(stateParam, local) {
	  if (local) {
		this.local = local;
	  }
  
	  const { value, key, id } = stateParam;
	  this.value = value;
	  this.key = key;
	  this.id = id;
	  this.virtualCollection = new Set();
	}
  
	getPassport(passport) {
	  this.passport = passport;
	}
  
	set(value) {
	  if (this.passport) {
		this.value = value;
		this.passport.value = this.value;
	  }
	}
  
	get() {
	  return this.value;
	}
  }
  
  class MCEngine {
	state;
	static active = false;
	constructor() {}
  
	handlerRender(target, fn, path) {
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
		set: (_, prop, val) => {
		  fn(this.state);
		  return target[prop];
		},
	  });
	  return proxy;
	}
  
	render(state) {
	  if (state.virtualCollection.length === 0) {
		return null;
	  }
	  MCEngine.active = true;
	  state.virtualCollection.forEach((virtualData) => {
		if (!virtualData.context) {
		  MC.anonimCollection.forEach((virtualEl) => {
			if (virtualEl.key === virtualData.id_element) {
			  let newNode;
			  if (virtualEl.component) {
				const global_values = [];
				virtualEl.controller.global.forEach((controller) => {
				  global_values.push(controller.value);
				});
  
				const local_values = [];
				virtualEl.controller.local.forEach((controller) => {
				  local_values.push(controller.value);
				});
				newNode = virtualEl.component.render(
				  { global: global_values, local: local_values },
				  virtualEl.props
				);
				if (!newNode) {
				  newNode = MC_Component.createEmptyElement();
				} else {
				  newNode = newNode[0];
				}
			  } else {
				const values = [];
				virtualEl.controller.forEach((controller) => {
				  values.push(controller.value);
				});
  
				newNode = virtualEl.Fn(values);
				if (!newNode) {
				  newNode = MC_Component.createEmptyElement();
				} else if (newNode.length) {
				  newNode = newNode[0];
				}
			  }
			  virtualEl.HTMLElement.replaceWith(newNode);
			  virtualEl.HTMLElement = newNode;
			}
		  });
  
		  MCEngine.active = false;
		  return;
		}
  
		MC.mc_context_global.forEach((context) => {
		  if (context.id === virtualData.context) {
			context.virtualCollection.forEach((virtualEl) => {
			  if (virtualEl.key === virtualData.id_element) {
				let newNode;
				if (virtualEl.component) {
				  const global_values = [];
				  virtualEl.controller.global.forEach((controller) => {
					global_values.push(controller.value);
				  });
  
				  const local_values = [];
				  virtualEl.controller.local.forEach((controller) => {
					local_values.push(controller.value);
				  });
  
				  newNode = virtualEl.component.render(
					{ global: global_values, local: local_values },
					virtualEl.props
				  );
  
				  if (!newNode) {
					newNode = MC_Component.createEmptyElement();
				  } else {
					newNode = newNode[0];
				  }
				} else {
				  const values = [];
				  virtualEl.controller.forEach((controller) => {
					values.push(controller.value);
				  });
  
				  newNode = virtualEl.Fn(values);
  
				  if (!newNode) {
					newNode = MC_Component.createEmptyElement();
				  } else {
					newNode = newNode[0];
				  }
				}
  
				virtualEl.HTMLElement.replaceWith(newNode);
				virtualEl.HTMLElement = newNode;
			  }
			});
		  }
		});
	  });
  
	  MCEngine.active = false;
	  return;
	}
  
	static renderChilds_FC(context, creator) {
	  let node = null;
	  let finder = false;
  
	  if (!context) {
		MC.anonimCollection.forEach((virtual) => {
		  if (!virtual.component) {
			if (virtual.Fn.toString() === creator.toString()) {
			  finder = true;
			  const values = [];
			  virtual.controller.forEach((controller) => {
				values.push(controller.value);
			  });
  
			  let newNode = virtual.Fn(values);
			  if (!newNode) {
				newNode = MC_Component.createEmptyElement();
			  } else {
				newNode = newNode[0];
			  }
			  virtual.HTMLElement = newNode;
			  node = virtual.HTMLElement;
			}
		  }
		});
		if (!finder) {
		  return "nt%Rnd#el";
		}
		return node;
	  }
  
	  context.virtualCollection.forEach((virtual) => {
		if (!virtual.component) {
		  if (virtual.Fn.toString() === creator.toString()) {
			finder = true;
			const values = [];
			virtual.controller.forEach((controller) => {
			  values.push(controller.value);
			});
  
			let newNode = virtual.Fn(values);
			if (!newNode) {
			  newNode = MC_Component.createEmptyElement();
			} else {
			  newNode = newNode[0];
			}
			virtual.HTMLElement = newNode;
			node = virtual.HTMLElement;
		  }
		}
	  });
	  if (!finder) {
		return "nt%Rnd#el";
	  }
	  return node;
	}
  
	static renderChilds_Component(component, props, key) {
	  if (!props) {
		console.error(
		  "[MC] Передайте при создании компонента его ключ! При отсутствии ключа, компонент может быть утерян!"
		);
		return "nt%Rnd#el";
	  }
	  if (typeof props === "string") {
		key = props;
	  }
	  const [prop, service] = props;
  
	  let node = null;
	  let finder = false;
  
	  if (!service.context) {
		MC.anonimCollection.forEach((virtual) => {
		  if (!virtual.Fn) {
			if (virtual.identifier === key) {
			  finder = true;
  
			  const global_values = [];
  
			  virtual.controller.global.forEach((controller) => {
				global_values.push(controller.value);
			  });
			  const local_values = [];
  
			  virtual.controller.local.forEach((controller) => {
				local_values.push(controller.value);
			  });
  
			  let newNode = virtual.component.render(
				{ global: global_values, local: local_values },
				service.props
			  );
			  
			  virtual.props = service.props; 
  
			  if (!newNode) {
				newNode = MC_Component.createEmptyElement();
			  } else {
				newNode = newNode[0];
			  }
			  virtual.HTMLElement = newNode;
			  node = virtual.HTMLElement;
			}
		  }
		});
		if (!finder) {
		  return "nt%Rnd#el";
		}
		return node;
	  }
  
	  service.context.virtualCollection.forEach((virtual) => {
		if (!virtual.Fn) {
		  if (virtual.identifier === key) {
			finder = true;
  
			const global_values = [];
  
			virtual.controller.global.forEach((controller) => {
			  global_values.push(controller.value);
			});
  
			const local_values = [];
  
			virtual.controller.local.forEach((controller) => {
			  local_values.push(controller.value);
			});
  
			let newNode = virtual.component.render(
			  { global: global_values, local: local_values },
			  service.props
			);
  
			virtual.props = service.props;
  
			if (!newNode) {
			  newNode = MC_Component.createEmptyElement();
			} else {
			  if (newNode.length) {
				newNode = newNode[0];
			  }
			}
			virtual.HTMLElement = newNode;
			node = virtual.HTMLElement;
		  }
		}
	  });
  
	  if (!finder) {
		return "nt%Rnd#el";
	  }
	  return node;
	}
  
	registrController(state) {
	  this.state = state;
	  const objectVirtualController = {
		value: state.id,
	  };
  
	  const passport = this.handlerRender(
		objectVirtualController,
		this.render,
		""
	  );
  
	  state.getPassport(passport);
	}
  }
  
  class MC_Component {
	constructor(html) {
	  return this.getComponent(html);
	}
  
	static createEmptyElement() {
	  const micro_component = document.createElement("micro_component");
  
	  micro_component.setAttribute(
		"style",
		"height: 0; width: 0; display: none;"
	  );
	  micro_component.setAttribute("mc", true);
  
	  return micro_component;
	}
  
	getComponent(HTML) {
	  return HTML;
	}
  }
  
  class MC_Component_Registration {
	constructor(newComponent) {
	  let [ComponentClass, componentArgs, key] = newComponent;
  
	  if (typeof componentArgs === "string") {
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
		const mc_component = new component(service.props, service.context);
  
		const locally_states = [];
  
		MC.mc_state_global.forEach((item) => {
		  if (item.local && item.local === mc_component) {
			locally_states.push(item);
		  }
		});
  
		const id = MC.uuidv4();
		const [virtual, NativeVirtual] = service.context.createVirtual_Component(
		  mc_component,
		  id,
		  key
		);
  
		const global_state = [];
  
		service.states &&
		  service.states.map((state) => {
			if (state.__proto__.constructor.name === "MCState") {
			  state.virtualCollection.add(virtual);
			  global_state.push(state.value);
			} else {
			  console.error("[MC] Ошибка обработки объекта контролёра.");
			}
		  });
  
		const local_state = [];
  
		locally_states &&
		  locally_states.map((state) => {
			if (state.__proto__.constructor.name === "MCState") {
			  state.virtualCollection.add(virtual);
			  local_state.push(state.value);
			} else {
			  console.error("[MC] Ошибка обработки объекта контролёра.");
			}
		  });
  
		NativeVirtual.props = service.props;
  
		const node = mc_component.render(
		  { global: global_state, local: local_state },
		  service.props,
		  service.props
		);
  
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
		  node[0].setAttribute("mc", true);
		  NativeVirtual.controller = { global: global_st, local: local_st };
		  NativeVirtual.HTMLElement = node[0];
		  return node[0];
		} else {
		  node.setAttribute("mc", true);
		  NativeVirtual.controller = { global: global_st, local: local_st };
		  NativeVirtual.HTMLElement = node;
		  return node;
		}
	  } else {
		const mc_component = new component(service.props, service.context);
  
		const locally_states = [];
  
		MC.mc_state_global.forEach((item) => {
		  if (item.local && item.local === mc_component) {
			locally_states.push(item);
		  }
		});
  
		const id = MC.uuidv4();
		const [virtual, NativeVirtual] = MC.createAnonimComponent(
		  mc_component,
		  id,
		  key
		);
  
		const global_state = [];
		service.states &&
		  service.states.map((state) => {
			if (state.__proto__.constructor.name === "MCState") {
			  state.virtualCollection.add(virtual);
			  global_state.push(state.value);
			} else {
			  console.error("[MC] Ошибка обработки объекта контролёра.");
			}
		  });
  
		const local_state = [];
  
		locally_states &&
		  locally_states.map((state) => {
			if (state.__proto__.constructor.name === "MCState") {
			  state.virtualCollection.add(virtual);
			  local_state.push(state.value);
			} else {
			  console.error("[MC] Ошибка обработки объекта контролёра.");
			}
		  });
  
		NativeVirtual.props = service.props;
  
		const node = mc_component.render(
		  { global: global_state, local: local_state },
		  service.props,
		  service.props
		);
  
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
		  node[0].setAttribute("mc", true);
		  NativeVirtual.controller = { global: global_st, local: local_st };
		  NativeVirtual.HTMLElement = node[0];
		  return node[0];
		} else {
		  node.setAttribute("mc", true);
		  NativeVirtual.controller = { global: global_st, local: local_st };
		  NativeVirtual.HTMLElement = node;
		  return node;
		}
	  }
	}
  }
  
  class MC {
	static keys = [];
	static mc_state_global = new Set();
	static mc_context_global = new Set();
  
	constructor() {
	  if (MC._instance) {
		return MC._instance;
	  }
	}
  
	static init() {
	  var original$ = window.$;
  
	  window.$.MC = function () {
		if (arguments[0].prototype instanceof MC) {
		  if (MCEngine.active) {
			const result = MCEngine.renderChilds_Component(...arguments);
			if (result !== "nt%Rnd#el") {
			  return result;
			}
		  }
  
		  return new MC_Component(new MC_Component_Registration(arguments));
		}
  
		const [arg1, arg2, arg3] = arguments;
		if (typeof arg1 === "function") {
		  if (MCEngine.active) {
			const result = MCEngine.renderChilds_FC(arg3, arg1);
			if (result !== "nt%Rnd#el") {
			  return result;
			}
		  }
  
		  if (arg3) {
			const id = MC.uuidv4();
			const [virtual, NativeVirtual] = arg3.createVirtual_FC(arg1, id);
			const values = [];
			arg2 &&
			  arg2.map((state) => {
				if (state.__proto__.constructor.name === "MCState") {
				  state.virtualCollection.add(virtual);
				  values.push(state.value);
				} else {
				  console.warn("Не стейт");
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
			  node[0].setAttribute("mc", true);
			  NativeVirtual.controller = arg2;
			  NativeVirtual.HTMLElement = node[0];
			  return node[0];
			} else {
			  node.setAttribute("mc", true);
			  NativeVirtual.controller = { global: global_st, local: local_st };
			  NativeVirtual.HTMLElement = node;
			  return node;
			}
		  } else {
			const creatorAnon = arg1;
			const dependencyAnon = arg2;
  
			const id = MC.uuidv4();
			const [virtual, NativeVirtual] = MC.createAnonim_FC(creatorAnon, id);
			const arg = [];
  
			dependencyAnon &&
			  dependencyAnon.map((state) => {
				if (state.__proto__.constructor.name === "MCState") {
				  state.virtualCollection.add(virtual);
				  arg.push(state.value);
				} else {
				  console.warn("Не стейт");
				}
			  });
  
			const node = creatorAnon(arg);
  
			if (!node) {
			  const micro_component = MC_Component.createEmptyElement();
			  NativeVirtual.controller = dependencyAnon;
			  NativeVirtual.HTMLElement = micro_component;
			  return micro_component;
			}
  
			if (node.length) {
			  node[0].setAttribute("mc", true);
			  NativeVirtual.controller = dependencyAnon;
			  NativeVirtual.HTMLElement = node[0];
			  return node[0];
			} else {
			  node.setAttribute("mc", true);
			  NativeVirtual.controller = dependencyAnon;
			  NativeVirtual.HTMLElement = node;
			  return node;
			}
		  }
		}
  
		let resultCall = original$.apply(this, arguments);
  
		return resultCall;
	  };
	}
  
	static anonimCollection = new Set();
  
	static createAnonim_FC(virtualFn, id) {
	  const virtualElement = {
		Fn: virtualFn,
		parent_id: null,
		key: id,
	  };
  
	  MC.anonimCollection.add(virtualElement);
  
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
  
	static Props(props_object) {
	  const props = [];
  
	  const serviceObject = {
		props: null,
		context: null,
		states: [],
	  };
  
	  for (let prop in props_object) {
		if (
		  !Array.isArray(props_object[prop]) &&
		  props_object[prop] instanceof MCcontext
		) {
		  props[2] = { context: props_object[prop] };
		  serviceObject.context = props_object[prop];
		  continue;
		}
  
		if (
		  Array.isArray(props_object[prop]) &&
		  props_object[prop].every((el) => el instanceof MCState)
		) {
		  props[1] = { states: props_object[prop] };
		  serviceObject.states = props_object[prop];
		  continue;
		}
  
		props[0] = { props: props_object[prop] };
		serviceObject.props = props_object[prop];
	  }
  
	  // Если в компоненте нет элементов на его место будет отдан undefined; Отметить в документации
	  return [props, serviceObject];
	}
  
	static uuidv4() {
	  return "10000000-1000-4000-8000-100000000000".replace(/[018]/g, (c) =>
		(
		  c ^
		  (crypto.getRandomValues(new Uint8Array(1))[0] & (15 >> (c / 4)))
		).toString(16)
	  );
	}
  
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
  
	static getContext() {
	  let context;
	  MC.mc_context_global.forEach((item) => {
		if (item.id === id) {
		  context = item;
		}
	  });
	  return context;
	}
  }
  