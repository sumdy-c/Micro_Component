class MCEngine {
	state;
	static active = false;
	static memoizedDOM = new WeakMap(); // cache DOM

	handlerRender(target, fn, path) {
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
		
		state.virtualCollection.forEach((virtualData) => {
			MCEngine.active = true;
			if (!virtualData.context) {
				
				MC.anonimCollection.forEach((virtualEl) => {
					if (!virtualEl.component) {
						return;
					}
					if (virtualEl.key === virtualData.id_element) {
						let newNode;
						const global_values = [];
						virtualEl.controller.global.forEach((controller) => {
							global_values.push(controller.value);
						});

						const local_values = [];
						virtualEl.controller.local.forEach((controller) => {
							local_values.push(controller.value);
						});

						const render_process_component = {
							onDemand: false,
						}
			
						const render_process_reflection = function(arg_fn) {
							arg_fn(render_process_component);
						}

						newNode = virtualEl.component.render(
							{ global: global_values, local: local_values },
							virtualEl.props,
							render_process_reflection
						);
						if(render_process_component.onDemand) {
							return;
						}

						if (!newNode) {
							newNode = MC_Component.createEmptyElement();
						} else {
							newNode = newNode[0];
						}

						newNode.setAttribute('mc', virtualEl.key);
						const controlledNode = MCDifference.diffAndApply(virtualEl.HTMLElement, newNode); // MCDifference.diffAndApply(virtualEl.HTMLElement.parentNode, newNode, virtualEl.HTMLElement);
						virtualEl.HTMLElement = controlledNode;
					}
				});

				MC.functionCollecton.forEach((virtualEl) => {
					if (!virtualEl.Fn) {
						return;
					}

					if (virtualEl.key === virtualData.id_element) {
						let newNode;
						
						const values = [];
						virtualEl.controller.forEach((controller) => {
							values.push(controller.value);
						});

						let render_process = {
							onDemand: false,
						}

						const render_process_reflection = function(arg_fn) {
							arg_fn(render_process);
						}

						newNode = virtualEl.Fn(values, render_process_reflection);

						if(render_process.onDemand) {
							MC.mc_solo_render_global.add(virtualEl.Fn.toString());	
						}

						if (!newNode) {
							newNode = MC_Component.createEmptyElement();
						} else if (newNode.length) {
							newNode = newNode[0];
						}

						newNode.setAttribute('mc', virtualEl.key);
						

						const controlledNode = MCDifference.diffAndApply(virtualEl.HTMLElement, newNode); //MCDifference.diffAndApply(virtualEl.HTMLElement.parentNode, newNode, virtualEl.HTMLElement);
						virtualEl.HTMLElement = controlledNode;
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

								const render_process_component = {
									onDemand: false,
								}
					
								const render_process_reflection = function(arg_fn) {
									arg_fn(render_process_component);
								}

								newNode = virtualEl.component.render(
									{ global: global_values, local: local_values },
									virtualEl.props,
									render_process_reflection
								);

								if(render_process_component.onDemand) {
									return;
								}

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

							newNode.setAttribute('mc', virtualEl.key);

							const controlledNode =  MCDifference.diffAndApply(virtualEl.HTMLElement, newNode); // MCDifference.diffAndApply(virtualEl.HTMLElement.parentNode, newNode, virtualEl.HTMLElement);
							virtualEl.HTMLElement = controlledNode;
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
			MC.functionCollecton.forEach((virtual) => {
				if (!virtual.component) {
					if (virtual.Fn.toString() === creator.toString()) {
						finder = true;
						const values = [];
						if(!virtual.controller || virtual.controller.length === 0) {
							MC.mc_solo_render_global.add(virtual.Fn.toString());
						} else {
							virtual.controller.forEach((controller) => {
								values.push(controller.value);
							});
						}

						let render_process = {
							onDemand: false,
						}

						const render_process_reflection = function(arg_fn) {
							arg_fn(render_process);
						}

						let newNode = virtual.Fn(values, render_process_reflection);

						if(render_process.onDemand) {
							MC.mc_solo_render_global.add(virtual.Fn.toString());	
						}

						if (!newNode) {
							newNode = MC_Component.createEmptyElement();
						} else {
							newNode = newNode[0];
						}

						newNode.setAttribute('mc', virtual.key);

						virtual.HTMLElement = newNode;
						node = virtual.HTMLElement;
					}
				}
			});
			if (!finder) {
				return 'nt%Rnd#el';
			}

			return node;
		}

		context.virtualCollection.forEach((virtual) => {
			console.error('Неожданная обработка!! Фиксация работы контекста с функциональным контейнером');
			return;
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
			return 'nt%Rnd#el';
		}
		return node;
	}

	static renderChilds_Component(component, props, key) {
		if (!props) {
			console.error(
				'[MC] Передайте при создании компонента его ключ! При отсутствии ключа, компонент может быть утерян!'
			);
			return 'nt%Rnd#el';
		}

		if (typeof props === 'string') {
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
						
						const [_pArr, pObj ] = props;

						if (pObj.controlled) {
							node = virtual.HTMLElement;
							return;
						}

						const global_values = [];

						virtual.controller.global.forEach((controller) => {
							global_values.push(controller.value);
						});
						const local_values = [];

						virtual.controller.local.forEach((controller) => {
							local_values.push(controller.value);
						});

						const render_process_component = {
							onDemand: false,
						}
			
						const render_process_reflection = function(arg_fn) {
							arg_fn(render_process_component);
						}

						let newNode = virtual.component.render(
							{ global: global_values, local: local_values },
							service.props,
							render_process_reflection
						);

						if(render_process_component.onDemand) {
							return;
						}

						virtual.props = service.props;

						if (!newNode) {
							newNode = MC_Component.createEmptyElement();
						} else {
							newNode = newNode[0];
						}

						newNode.setAttribute('mc', virtual.key);
						
						virtual.HTMLElement = newNode;
						node = virtual.HTMLElement;
					}
				}
			});
			if (!finder) {
				return 'nt%Rnd#el';
			}
			return node;
		}

		service.context.virtualCollection.forEach((virtual) => {
			if (!virtual.Fn) {
				if (virtual.identifier === key) {
					finder = true;

					const [_pArr, pObj ] = props;

					if (pObj.controlled) {
						node = virtual.HTMLElement;
						return;
					}	

					const global_values = [];

					virtual.controller.global.forEach((controller) => {
						global_values.push(controller.value);
					});

					const local_values = [];

					virtual.controller.local.forEach((controller) => {
						local_values.push(controller.value);
					});

					const render_process_component = {
						onDemand: false
					}
		
					const render_process_reflection = function(arg_fn) {
						arg_fn(render_process_component);
					}

					let newNode = virtual.component.render(
						{ global: global_values, local: local_values },
						service.props,
						render_process_reflection
					);

					if(render_process_component.onDemand) {
						return;
					}

					virtual.props = service.props;

					if (!newNode) {
						newNode = MC_Component.createEmptyElement();
					} else {
						if (newNode.length) {
							newNode = newNode[0];
						}
					}

					// const eventIdAttr = virtual.HTMLElement.getAttribute('mc-event-id');
						
					// if(eventIdAttr) {
					// 	newNode.setAttribute('mc-event-id', eventIdAttr);
					// }

					newNode.setAttribute('mc', virtual.key);
					newNode.setAttribute('mc_context', service.context.id);

					virtual.HTMLElement = newNode;
					node = virtual.HTMLElement;
				}
			}
		});

		if (!finder) {
			return 'nt%Rnd#el';
		}
		return node;
	}

	registrController(state) {
		this.state = state;
		const objectVirtualController = {
			value: state.id,
		};

		const passport = this.handlerRender(objectVirtualController, this.render, '');

		state.getPassport(passport);
	}
}
