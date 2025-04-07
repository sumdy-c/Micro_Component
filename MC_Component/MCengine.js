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

	/** work */
	// static updateAttributes(oldNode, newNode) {
	// 	const oldAttrs = oldNode.attributes;
	// 	const newAttrs = newNode.attributes;
	// 	console.log(oldNode);
	// 	if(!oldAttrs || ! newAttrs) {
	// 		return;
	// 	}
	
	// 	// Создаём Set всех атрибутов для быстрого поиска
	// 	const oldAttrNames = new Set(Array.from(oldAttrs).map(attr => attr.name));
	// 	const newAttrNames = new Set(Array.from(newAttrs).map(attr => attr.name));

	// 	// Удаляем старые атрибуты, если их больше нет в новом узле
	// 	oldAttrNames.forEach(attrName => {
	// 		if(attrName === 'mc' || attrName === 'mc-event-id' || attrName === 'mc_context') {
	// 			return;
	// 		}

	// 		if (!newAttrNames.has(attrName)) {
	// 			oldNode.removeAttribute(attrName);
	// 		}
	// 	});
	
	// 	// Добавляем новые атрибуты или обновляем существующие
	// 	newAttrNames.forEach(attrName => {
	// 		const newValue = newNode.getAttribute(attrName);
	// 		if (oldNode.getAttribute(attrName) !== newValue) {
	// 			oldNode.setAttribute(attrName, newValue);
	// 		}
	// 	});
	// }

	// static virtualUpdate(component) {
	// 	const mcKey = component.getAttribute('mc');
	// 	let isFind = !mcKey ? true : false;

	// 	!isFind && MC.functionCollecton.forEach(virtual => {
	// 		if(virtual.key === mcKey) {
	// 			virtual.HTMLElement = component;
	// 			isFind = true;
	// 		}
	// 	});

	// 	!isFind && MC.anonimCollection.forEach(virtual => {
	// 		if(virtual.key === mcKey) {
	// 			virtual.HTMLElement = component;
	// 			isFind = true;
	// 		}
	// 	});

	// 	const contextKey = component.getAttribute('mc_context');

	// 	!isFind && MC.mc_context_global.forEach(cnxt => {
	// 		if(cnxt.id === contextKey) {
	// 			cnxt.virtualCollection.forEach(virtual => {
	// 				if(virtual.key === mcKey) {
	// 					virtual.HTMLElement = component;
	// 				}
	// 			});
	// 		}
	// 	});

	// 	const childs = Array.from(component.childNodes);

	// 	for (let i = 0; i < childs.length; i++) {
	// 		if(childs[i] && childs[i].nodeType === Node.ELEMENT_NODE) {
	// 			MCEngine.virtualUpdate(childs[i]); 
	// 		}
	// 	}
	// }
	 /**
     * ⚡️ diff-check
     */
	// static updateElementWithDiff(parent, newNode, oldNode) {
    //     if (!oldNode) {
    //         parent.appendChild(newNode.cloneNode(true));
    //         MCEngine.memoizedDOM.set(newNode, newNode.cloneNode(true));
    //         return newNode;
    //     }

    //     if (!newNode) {
    //         parent.removeChild(oldNode);
    //         MCEngine.memoizedDOM.delete(oldNode);
    //         return null;
    //     }

    //     if (newNode.nodeType !== oldNode.nodeType || newNode.tagName !== oldNode.tagName) {
    //         const newElement = parent.replaceChild(newNode.cloneNode(true), oldNode);
    //         MCEngine.memoizedDOM.set(newElement, newElement.cloneNode(true));
	// 		return newElement;
    //     }

    //     // Проверяем кеш (если нет изменений, выходим)
    //     const prevSnapshot = MCEngine.memoizedDOM.get(oldNode);
    //     if (prevSnapshot && prevSnapshot.isEqualNode(newNode)) {

	// 		const oldChildren = Array.from(oldNode.childNodes);
	// 		for(let i = 0; i < oldChildren.length; i++) {
	// 			if(oldChildren[i] && oldChildren[i].nodeType === Node.ELEMENT_NODE) {
	// 				MCEngine.virtualUpdate(oldChildren[i]); 
	// 			}
	// 		}
	// 		return oldNode;
    //     }

    //     // Обновляем атрибуты
    //     MCEngine.updateAttributes(oldNode, newNode);

    //     // Обновляем текст
    //     if (newNode.nodeType === Node.TEXT_NODE && newNode.textContent !== oldNode.textContent) {
	// 		oldNode.textContent = newNode.textContent;
    //     }

    //     // Обновляем детей
    //     const oldChildren = Array.from(oldNode.childNodes);
    //     const newChildren = Array.from(newNode.childNodes);

    //     const max = Math.max(oldChildren.length, newChildren.length);
    //     for (let i = 0; i < max; i++) {
    //         const newComponent = MCEngine.updateElementWithDiff(oldNode, newChildren[i], oldChildren[i]);

	// 		if(newComponent && newComponent.nodeType === Node.ELEMENT_NODE) {
	// 			MCEngine.virtualUpdate(newComponent); 
	// 		}
    //     }

    //     // Запоминаем обновленное состояние в кеш
    //     MCEngine.memoizedDOM.set(oldNode, oldNode.cloneNode(true));

	// 	return oldNode;
    // }

	static updateElementWithDiff(parentNode, newNode, oldNode) {
		if(!oldNode || !newNode) {
			console.error('MC diff | Неожиданное поведение при попытке перерисовки DOM');
			return null;
		}

		// проверяем имя тэга, при несовпадении - меняем элемент полностью
		if(oldNode.nodeName !== newNode.nodeName) {
			oldNode.replaceWith(newNode);
			return newNode;
		}

		if(oldNode.nodeType === Node.TEXT_NODE && newNode.nodeType === Node.TEXT_NODE) {
			if(oldNode.textContent !== newNode.textContent) {
				oldNode.textContent = newNode.textContent;
			}
		}

		if(oldNode.nodeType === Node.ELEMENT_NODE && newNode.nodeType === Node.ELEMENT_NODE) {
			// проверка на соотвествие количества элементов, если не соотвествуют, то нужно либо добавить, либо убрать элемент
			if(oldNode.childNodes.length === newNode.childNodes.length) {
				for(let indxNode = 0; newNode.childNodes.length > indxNode; indxNode++) {
					const chldOldNode = oldNode.childNodes[indxNode];
					const chldNewNode = newNode.childNodes[indxNode];

					// ???
					const preControlledEl = MCEngine.updateElementWithDiff(oldNode, chldNewNode, chldOldNode);
				}
			}
			// тут несоотвествие детей, проводим проверку.
			// - принимаем как правило, новая нода ( newNode ) = ВСЕГДА актуальнее, чем старая!
			// - Изменение тэга - ВСЕГДА replaceWith
			
			// DELETE = 0 ; APPEND = 1;
			const changeFlag = oldNode.childNodes.length > newNode.childNodes.length ? 0 : 1;

			const batchArr = [];
		
			// самая сложная часть тут - сведение актуального индекса элемента для сравнения деревьев
			let indxOldNode = 0;
			for(let indxNewNode = 0; newNode.childNodes.length > indxNewNode; indxNewNode++) {
				const chldOldNode = oldNode.childNodes[indxOldNode];
				const chldNewNode = newNode.childNodes[indxNewNode];

				if(chldOldNode.nodeName !== chldNewNode.nodeName || chldOldNode.textContent !== chldNewNode.textContent) {
					if(changeFlag) {
						batchArr.push({ flag: changeFlag, parent: oldNode, oldNode: chldOldNode, newNode: chldNewNode });
						continue;
					} else {
						batchArr.push({ flag: changeFlag, parent: oldNode, oldNode: chldOldNode, newNode: chldNewNode });
						continue;
					}
				}

				indxOldNode++;
			}

			for(let batchInx = 0; batchArr.length > batchInx; batchInx++) {
				const { flag, newNode, oldNode, parent } = batchArr[batchInx];
				if(flag) {
					parent.insertBefore(newNode, oldNode);
				} else {
					parent.removeChild(oldNode);
				}

			}
		}

		return oldNode;
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

						// const eventIdAttr = virtualEl.HTMLElement.getAttribute('mc-event-id');
						
						// if(eventIdAttr) {
						// 	newNode.setAttribute('mc-event-id', eventIdAttr);
						// }

						newNode.setAttribute('mc', virtualEl.key);
						const controlledNode = MCEngine.updateElementWithDiff(virtualEl.HTMLElement.parentNode, newNode, virtualEl.HTMLElement);
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

						// const eventIdAttr = virtualEl.HTMLElement.getAttribute('mc-event-id');
						
						// if(eventIdAttr) {
						// 	newNode.setAttribute('mc-event-id', eventIdAttr);
						// }

						newNode.setAttribute('mc', virtualEl.key);
						

						const controlledNode = MCEngine.updateElementWithDiff(virtualEl.HTMLElement.parentNode, newNode, virtualEl.HTMLElement);
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

							// const eventIdAttr = virtualEl.HTMLElement.getAttribute('mc-event-id');
						
							// if(eventIdAttr) {
							// 	newNode.setAttribute('mc-event-id', eventIdAttr);
							// }

							newNode.setAttribute('mc', virtualEl.key);

							const controlledNode = MCEngine.updateElementWithDiff(virtualEl.HTMLElement.parentNode, newNode, virtualEl.HTMLElement);
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

						// const eventIdAttr = virtual.HTMLElement.getAttribute('mc-event-id');
						
						// if(eventIdAttr) {
						// 	newNode.setAttribute('mc-event-id', eventIdAttr);
						// }

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

						// const eventIdAttr = virtual.HTMLElement.getAttribute('mc-event-id');
						
						// if(eventIdAttr) {
						// 	newNode.setAttribute('mc-event-id', eventIdAttr);
						// }

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
