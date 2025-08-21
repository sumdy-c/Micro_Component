class MC_Component {
	/**
	 * Ссылка на MC
	 */
	mc;

	constructor(mc) {
		this.mc = mc;
	}

	createNewInstance(normalized) {
		const instance = new normalized.component;
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
			component: instance
    	};

		for(const prop in instance) {
			if(instance[prop] instanceof MCState) {
				const localState = instance[prop];

				localState.traceKey = `lcl_state_${normalized.key}`;
				normalized.states.push(instance[prop]);

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

		if(normalized.states.length) {
			for(const state of normalized.states) {
				if (state.__proto__.constructor.name === 'MCState') {
					state.virtualCollection.add({ effectKey: NativeVirtual.key });
					NativeVirtual.states.set(state.id, state.value);
				} else {
					this.mc.log.error('Неверный стейт', [
						'Переданная сигнатура состояния неверна. Проверьте данные которые вы передали в зависимости',
					]);
				}
			}
		}

		this.start(NativeVirtual, normalized);

		NativeVirtual.HTML.instanceMC = NativeVirtual.id;
		NativeVirtual.HTML.instanceMCtype = 'mc_component';

		return NativeVirtual.HTML;
	}

	start(NativeVirtual, normalized) {
		const dependency = normalized.states;

		if(this.mc.getCurrentRenderingInstance()) {
			NativeVirtual.HTML = this.mc.engine.rerender(NativeVirtual, 'mc_component');
			return;
		}
		
		if (dependency && dependency.length) {
			const [ firstState ] = dependency;
			NativeVirtual.states.set(firstState.id, `reset_state_initial_${this.mc.uuidv4()}`);
			firstState.initial();
		} else {
			this.mc.engine.controlledRender(NativeVirtual, 'mc_component');
		}
	}
}