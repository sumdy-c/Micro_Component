class MCEngine {
	mc;

	constructor(mc) {
		this.mc = mc;
		this.diff = new MCDiff(this.mc);
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
		const JQ_CONTAINER = VDOM.draw(this.getArrayValuesStates(VDOM), VDOM.options);
		const NEW_HTML = this.jqToHtml(JQ_CONTAINER) ?? new MC_Element().createEmptyElement();
		VDOM.HTML = this.diff.start(VDOM.HTML, NEW_HTML);
		VDOM.HTML.instanceMC = VDOM.id;
		VDOM.HTML.instanceMCtype = 'fn';
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
		if (this.mc.constructor.name !== 'MC') {
			this.mc = this.mc.mc;
		}

		this.mc.setCurrentRenderingInstance(VDOM.key);
		const stateObject = this.formationStates(VDOM);
		const JQ_CONTAINER = VDOM.draw.call(VDOM.component, stateObject, VDOM.normalized.props, VDOM);
		this.mc.resetCurrentRenderingInstance();
		const NEW_HTML = this.jqToHtml(JQ_CONTAINER) ?? new MC_Element().createEmptyElement();
		VDOM.HTML = this.diff.start(VDOM.HTML, NEW_HTML);
		VDOM.HTML.instanceMC = VDOM.id;
		VDOM.HTML.instanceMCtype = 'mc_component';
	}

	/**
	 * Обновить ссылку на компонент для дочернего VDOM
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
			VDOM.HTML = NEW_HTML;
			VDOM.HTML.instanceMC = VDOM.id;
			VDOM.HTML.instanceMCtype = 'mc_component';
		} else {
			const JQ_CONTAINER = VDOM.draw(this.getArrayValuesStates(VDOM));
			NEW_HTML = this.jqToHtml(JQ_CONTAINER) ?? new MC_Element().createEmptyElement();
			VDOM.HTML = NEW_HTML;
			VDOM.HTML.instanceMC = VDOM.id;
			VDOM.HTML.instanceMCtype = 'fn';
		}

		return VDOM.HTML;
	}

	render(state, mc, engine) {
		Boolean(state.fcCollection.size) && engine.renderFunctionContainer(state, mc);
		Boolean(state.virtualCollection.size) && engine.renderComponentWork(state, mc);
		Boolean(state.effectCollection.size) && engine.runEffectWork(state, mc);
	}

	/**
	 * Контролируемый рендер для классового компонента
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
			const value = virtual.states.get(state.id);

			if (value !== state.value) {
				virtual.states.set(state.id, state.value);
				this.diffing(virtual);
			}
		});
	}

	renderComponentWork(state, mc) {
		if (mc.constructor.name !== 'MC') {
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
		if (mc.constructor.name !== 'MC') {
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

		const passport = this.handlerRender(objectVirtualController, this.render, '', state);

		state.setPassport(passport);
	}
}