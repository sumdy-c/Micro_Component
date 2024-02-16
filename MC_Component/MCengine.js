class MCEngine {
	state;
	static active = false;
	constructor() {}

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
				return 'nt%Rnd#el';
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
							service.props,
							virtual.props
						);

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
						service.props,
						virtual.props
					);
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