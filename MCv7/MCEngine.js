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
