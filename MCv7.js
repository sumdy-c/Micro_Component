// v7
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

class MCDiffirence {
    // === ТОЧКА ВХОДА ===
    static diffAndApply(oldNode, newNode) {
        // console.groupCollapsed('[MCDiffirence] diffAndApply');
        try {
            const trace = DiffMaster.diffNode(oldNode, newNode, { level: 0, path: '' });
            const node = PatchMaster.applyPatch(trace, oldNode, { level: 0, path: '' });
            // console.log('[MCDiffirence] Patch applied:', trace);
            return node;
        } catch (e) {
            console.error('[MCDiffirence] Diff/Patch error:', e);
            throw e;
        } finally {
            // console.groupEnd();
        }
    }
}

// =================== DIFF ENGINE ===================

class DiffMaster {
    /**
     * Основная функция сравнения двух узлов
     * Возвращает структуру патча ("trace"), содержащую необходимые операции для применения изменений.
     */
    static diffNode(oldNode, newNode, ctx) {
        const context = Object.assign({ level: 0, path: '' }, ctx);

        // === Базовые случаи: отсутствие узлов ===
        if (!oldNode && newNode) {
            return { type: 'ADD', node: newNode.cloneNode(true), ctx: context };
        }
        if (oldNode && !newNode) {
            return { type: 'REMOVE', ctx: context };
        }
        if (!oldNode && !newNode) {
            return { type: 'NONE', ctx: context };
        }

        // === Типы узлов ===
        if (oldNode.nodeType !== newNode.nodeType) {
            return { type: 'REPLACE', node: newNode.cloneNode(true), ctx: context };
        }

        // === Текстовые узлы ===
        if (oldNode.nodeType === Node.TEXT_NODE) {
            if (oldNode.textContent !== newNode.textContent) {
                return { type: 'TEXT', text: newNode.textContent, ctx: context };
            }
            return { type: 'NONE', ctx: context };
        }

        // === Комментарии ===
        if (oldNode.nodeType === Node.COMMENT_NODE) {
            if (oldNode.textContent !== newNode.textContent) {
                return { type: 'COMMENT', text: newNode.textContent, ctx: context };
            }
            return { type: 'NONE', ctx: context };
        }

        // === DOCUMENT_FRAGMENT_NODE, DOCUMENT_NODE, DOCUMENT_TYPE_NODE ===
        if (
            oldNode.nodeType === Node.DOCUMENT_FRAGMENT_NODE ||
            oldNode.nodeType === Node.DOCUMENT_NODE ||
            oldNode.nodeType === Node.DOCUMENT_TYPE_NODE
        ) {
            // Сравнение детей (кроме типа)
            return DiffMaster.diffChildren(oldNode, newNode, context);
        }

        // === Элементные узлы ===
        if (oldNode.nodeType === Node.ELEMENT_NODE) {
            // Проверяем тэг
            if (oldNode.nodeName !== newNode.nodeName) {
                return { type: 'REPLACE', node: newNode.cloneNode(true), ctx: context };
            }

            // Сравнение атрибутов, стилей, классов, событий
            const attrPatch = AttrDiff.diffAttributes(oldNode, newNode, context);
            const stylePatch = StyleDiff.diffStyles(oldNode, newNode, context);
            const classPatch = ClassDiff.diffClasses(oldNode, newNode, context);
            const eventPatch = EventDiff.diffEvents(oldNode, newNode, context);

            // Дети
            const childrenPatch = DiffMaster.diffChildren(oldNode, newNode, context);

            return {
                type: 'UPDATE',
                attrPatch,
                stylePatch,
                classPatch,
                eventPatch,
                childrenPatch,
                ctx: context
            };
        }

        // === Падение по умолчанию: нераспознанный случай ===
        return { type: 'REPLACE', node: newNode.cloneNode(true), ctx: context };
    }

    /**
     * Рекурсивное сравнение детей узлов
     */
    static diffChildren(oldNode, newNode, ctx) {
        const context = Object.assign({}, ctx, { level: (ctx.level || 0) + 1 });
        const oldChildren = Array.from(oldNode.childNodes);
        const newChildren = Array.from(newNode.childNodes);
        const maxLen = Math.max(oldChildren.length, newChildren.length);
        const childPatches = [];

        for (let i = 0; i < maxLen; i++) {
            const path = context.path + '/' + i;
            childPatches.push(
                DiffMaster.diffNode(oldChildren[i], newChildren[i], { ...context, path })
            );
        }
        return { type: 'CHILDREN', patches: childPatches, ctx: context };
    }
}

// =================== PATCH ENGINE ===================

class PatchMaster {
    /**
     * Применяет патч к DOM-узлу.
     */
    static applyPatch(patch, domNode, ctx) {
        if (!patch) return domNode;
        const context = Object.assign({ level: 0, path: '' }, ctx);

        switch (patch.type) {
            case 'ADD':
                PatchMaster._log('ADD', context);
                if (domNode && domNode.parentNode) {
                    domNode.parentNode.appendChild(patch.node.cloneNode(true));
                }
                return patch.node;
            case 'REMOVE':
                PatchMaster._log('REMOVE', context);
                if (domNode && domNode.parentNode) {
                    domNode.parentNode.removeChild(domNode);
                }
                return null;
            case 'REPLACE':
                PatchMaster._log('REPLACE', context);
                if (domNode && domNode.parentNode) {
                    domNode.parentNode.replaceChild(patch.node.cloneNode(true), domNode);
                    return patch.node;
                }
                return patch.node;
            case 'TEXT':
                PatchMaster._log('TEXT', context);
                domNode.textContent = patch.text;
                return domNode;
            case 'COMMENT':
                PatchMaster._log('COMMENT', context);
                domNode.textContent = patch.text;
                return domNode;
            case 'UPDATE':
                PatchMaster._log('UPDATE', context);
                // Атрибуты
                AttrDiff.applyAttributes(patch.attrPatch, domNode);
                // Стили
                StyleDiff.applyStyles(patch.stylePatch, domNode);
                // Классы
                ClassDiff.applyClasses(patch.classPatch, domNode);
                // События
                EventDiff.applyEvents(patch.eventPatch, domNode);
                // Дети
                PatchMaster.applyPatch(patch.childrenPatch, domNode, context);
                return domNode;
            case 'CHILDREN':
                PatchMaster._log('CHILDREN', context);
                PatchMaster._applyChildren(patch.patches, domNode, context);
                return domNode;
            case 'NONE':
                PatchMaster._log('NONE', context);
                return domNode;
            default:
                PatchMaster._log('UNKNOWN', context);
                return domNode;
        }
    }

    /**
     * Rекурсивное применение патчей к детям.
     */
    static _applyChildren(childPatches, domNode, ctx) {
        for (let i = 0; i < childPatches.length; i++) {
            const patch = childPatches[i];
            const child = domNode.childNodes[i];
            // ADD: append
            if (!child && patch && patch.type === 'ADD') {
                domNode.appendChild(patch.node.cloneNode(true));
                continue;
            }
            // REMOVE
            if (child && patch && patch.type === 'REMOVE') {
                domNode.removeChild(child);
                continue;
            }
            // EMPTY SKIP
            if (!child && patch) continue;
            // RECURSIVE
            if (child && patch) {
                PatchMaster.applyPatch(patch, child, ctx);
            }
        }
        // Если новые дети длиннее старых — добавить недостающих
        for (let i = domNode.childNodes.length; i < childPatches.length; i++) {
            const patch = childPatches[i];
            if (patch && patch.type === 'ADD') {
                domNode.appendChild(patch.node.cloneNode(true));
            }
        }
    }

    static _log(type, ctx) {
        if (ctx && ctx.level < 5) {
            // Ограничим уровень вложенности логов
            console.log(`[MCDiffirence] Patch type: ${type} | path: ${ctx.path}`, ctx);
        }
    }
}

// =================== ATTRIBUTES DIFF ===================

class AttrDiff {
    static diffAttributes(oldNode, newNode, ctx) {
        const oldAttrs = oldNode.attributes ? Array.from(oldNode.attributes) : [];
        const newAttrs = newNode.attributes ? Array.from(newNode.attributes) : [];
        const set = {};
        const remove = [];

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
        return { set, remove, ctx };
    }

    static applyAttributes(attrPatch, domNode) {
        if (!attrPatch) return;
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
    static diffStyles(oldNode, newNode, ctx) {
        // Обработка inline-стилей
        const oldStyle = oldNode.getAttribute && oldNode.getAttribute('style') || '';
        const newStyle = newNode.getAttribute && newNode.getAttribute('style') || '';
        if (oldStyle !== newStyle) {
            return { set: newStyle, ctx };
        }
        return { ctx };
    }

    static applyStyles(stylePatch, domNode) {
        if (!stylePatch) return;
        if ('set' in stylePatch) {
            domNode.setAttribute('style', stylePatch.set);
        }
    }
}

// =================== CLASS DIFF ===================

class ClassDiff {
    static diffClasses(oldNode, newNode, ctx) {
        // Обработка class атрибута (строка или список)
        const oldClass = oldNode.getAttribute && oldNode.getAttribute('class') || '';
        const newClass = newNode.getAttribute && newNode.getAttribute('class') || '';
        if (oldClass !== newClass) {
            return { set: newClass, ctx };
        }
        return { ctx };
    }

    static applyClasses(classPatch, domNode) {
        if (!classPatch) return;
        if ('set' in classPatch) {
            domNode.setAttribute('class', classPatch.set);
        }
    }
}

// =================== EVENTS DIFF ===================
class EventDiff {
    static diffEvents(oldNode, newNode, ctx) {
        // Упрощённая: сравнивает только онхендлеры (on*)
        const oldAttrs = oldNode.attributes ? Array.from(oldNode.attributes) : [];
        const newAttrs = newNode.attributes ? Array.from(newNode.attributes) : [];
        const set = {};
        const remove = [];

        for (const attr of newAttrs) {
            if (/^on/i.test(attr.name)) {
                if (oldNode.getAttribute(attr.name) !== attr.value) {
                    set[attr.name] = attr.value;
                }
            }
        }
        for (const attr of oldAttrs) {
            if (/^on/i.test(attr.name) && !newNode.hasAttribute(attr.name)) {
                remove.push(attr.name);
            }
        }
        return { set, remove, ctx };
    }

    static applyEvents(eventPatch, domNode) {
        if (!eventPatch) return;
        // Снимаем устаревшие
        for (const attr of eventPatch.remove || []) {
            domNode.removeAttribute(attr);
        }
        // Навешиваем новые
        for (const [attr, val] of Object.entries(eventPatch.set || {})) {
            domNode.setAttribute(attr, val);
        }
    }
}

// =================== UTILS ===================

/**
 * Хелперы для глубокого сравнения объектов, массивов, и т.п.
 * (Могут быть использованы для расширения diff: props, dataset, future-keys)
 */
class DeepUtils {
    static shallowEqual(a, b) {
        if (a === b) return true;
        if (!a || !b) return false;
        const aKeys = Object.keys(a);
        const bKeys = Object.keys(b);
        if (aKeys.length !== bKeys.length) return false;
        for (const key of aKeys) {
            if (a[key] !== b[key]) return false;
        }
        return true;
    }
    static deepEqual(a, b) {
        if (a === b) return true;
        if (typeof a !== typeof b) return false;
        if (typeof a !== 'object' || !a || !b) return false;
        if (Array.isArray(a) !== Array.isArray(b)) return false;
        if (Array.isArray(a)) {
            if (a.length !== b.length) return false;
            for (let i = 0; i < a.length; i++) {
                if (!DeepUtils.deepEqual(a[i], b[i])) return false;
            }
            return true;
        }
        const aKeys = Object.keys(a);
        const bKeys = Object.keys(b);
        if (aKeys.length !== bKeys.length) return false;
        for (const key of aKeys) {
            if (!DeepUtils.deepEqual(a[key], b[key])) return false;
        }
        return true;
    }
}

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
						MC.savedEvents(newNode);
						const controlledNode = MCDiffirence.diffAndApply(virtualEl.HTMLElement, newNode);
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
						
						MC.savedEvents(newNode);
						const controlledNode = MCDiffirence.diffAndApply(virtualEl.HTMLElement, newNode);
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
							MC.savedEvents(newNode);
							const controlledNode =  MCDiffirence.diffAndApply(virtualEl.HTMLElement, newNode); // MCDiffirence.diffAndApply(virtualEl.HTMLElement.parentNode, newNode, virtualEl.HTMLElement);
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
						MC.savedEvents(newNode);
						
						const controlledNode = MCDiffirence.diffAndApply(virtual.HTMLElement, newNode);

						node = controlledNode; //virtual.HTMLElement;
						
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

class MCEventManager {
	static registry = new Map(); // Map<eventId, Array<{type, handler}>>

	static generateId() {
		return 'mc-event-' + Math.random().toString(36).slice(2, 10);
	}

	static bind(node, type, handler) {
		let id = node.getAttribute('mc-event-id');
		if (!id) {
			id = MCEventManager.generateId();
			node.setAttribute('mc-event-id', id);
		}
		if (!MCEventManager.registry.has(id)) {
			MCEventManager.registry.set(id, []);
		}
		MCEventManager.registry.get(id).push({ type, handler });
		node.addEventListener(type, handler);
	}

	static unbindAll(node) {
		const id = node.getAttribute('mc-event-id');
		if (!id) {
            return;
        }

		const events = MCEventManager.registry.get(id) || [];
		events.forEach(({ type, handler }) => {
			node.removeEventListener(type, handler);
		});
		MCEventManager.registry.delete(id);
	}

	static rebindAll(node) {
		const id = node.getAttribute('mc-event-id');
		if (!id) {
            return;
        }

		const events = MCEventManager.registry.get(id) || [];
		events.forEach(({ type, handler }) => {
			node.addEventListener(type, handler);
		});
	}

	static bindAll(node, events) {
		events.forEach(({ type, handler }) => {
			MCEventManager.bind(node, type, handler);
		});
	}

	/**
	 * Рекурсивно перевешивает все события для поддерева начиная с root
	 * @param {Element} root
	 */
	static deepRebind(root) {
		if (root.nodeType !== 1) {
            return;
        }
        
		MCEventManager.rebindAll(root);
		for (const child of root.children) {
			MCEventManager.deepRebind(child);
		}
	}

	/**
	 * Рекурсивно снимает все события для поддерева начиная с root
	 * @param { Element } root
	 */
	static deepUnbind(root) {
		if (root.nodeType !== 1) {
            return;
        }

		MCEventManager.unbindAll(root);
		for (const child of root.children) {
			MCEventManager.deepUnbind(child);
		}
	}

	/**
	 * Рекурсивно сканирует DOM-дерево и регистрирует все jQuery-события
	 * @param {Element} element
	 */
	static scanAndBind(element) {
		function scan(el) {
			const events = window.$ && window.$._data ? window.$._data(el, "events") : undefined;
			if (events) {
				Object.keys(events).forEach(type => {
					events[type].forEach(({handler}) => {
						MCEventManager.bind(el, type, handler);
					});
				});
				window.$(el).off();
			}
			for (const child of el.children) scan(child);
		}
		scan(element);
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
	 * Если состояние локальное, хранит ссылку на компонент
	 */
	local;

	/**
	 *
	 * @param {Object} stateParam
	 * @param {*} local
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

	/**
	 * Устанавливает новое значение состояния.
	 * Если включён режим controlled и новое значение глубоко равно старому,
	 * обновление не происходит.
	 * @param {*} newValue
	 */
	set(newValue) {
		if (MC.MC_setting.controlled && MCState.deepEqual(newValue, this.value)) {
			return;
		}

		if (this.passport) {
			this.value = newValue;
			this.passport.value = this.value;
		}
	}

	/**
	 * Возвращает глубокую копию значения состояния.
	 */
	get() {
		return MCState.deepClone(this.value);
	}

	/**
	 * Рекурсивная функция глубокого сравнения двух значений.
	 * Возвращает true, если значения равны.
	 * @param {*} a
	 * @param {*} b
	 */
	static deepEqual(a, b) {
		if (a === b) return true;
		if (typeof a !== 'object' || a === null || typeof b !== 'object' || b === null) {
			return false;
		}

		// Если один из объектов является массивом, а другой нет – не равны
		if (Array.isArray(a) !== Array.isArray(b)) return false;

		if (Array.isArray(a)) {
			if (a.length !== b.length) return false;
			for (let i = 0; i < a.length; i++) {
				if (!MCState.deepEqual(a[i], b[i])) return false;
			}
			return true;
		}

		const keysA = Object.keys(a);
		const keysB = Object.keys(b);
		if (keysA.length !== keysB.length) return false;

		for (let key of keysA) {
			if (!b.hasOwnProperty(key) || !MCState.deepEqual(a[key], b[key])) {
				return false;
			}
		}

		return true;
	}

	/**
	 * Рекурсивная функция глубокого клонирования значения.
	 * Используется в MCView для сохранения состояний!!!
	 * @param {*} value
	 */
	static deepClone(value) {
		if (value === null || typeof value !== 'object') {
			return value;
		}

		if (value instanceof Date) {
			return new Date(value.getTime());
		}

		if (Array.isArray(value)) {
			return value.map(item => MCState.deepClone(item));
		}

		const clonedObj = {};
		for (let key in value) {
			if (value.hasOwnProperty(key)) {
				clonedObj[key] = MCState.deepClone(value[key]);
			}
		}
		return clonedObj;
	}
}

class MC_Component {
	globalEventsMap;
	constructor(html) {
		this.globalEventsMap = null;
		return this.getComponent(html);
	}

	static createEmptyElement(key, contextKey) {
		const micro_component = document.createElement('micro_component');

		micro_component.setAttribute('style', 'height: 0; width: 0; display: none;');
		micro_component.setAttribute('mc', key);
		contextKey && micro_component.setAttribute('mc_context', contextKey);

		return micro_component;
	}

	getComponent(HTML) {
		MC.savedEvents(HTML);
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
				const micro_component = MC_Component.createEmptyElement(NativeVirtual.key, service.context.id);
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
				node[0].setAttribute('mc', NativeVirtual.key);
				node[0].setAttribute('mc_context', service.context.id);
				NativeVirtual.controller = { global: global_st, local: local_st };
				MC.savedEvents(node[0]);
				NativeVirtual.HTMLElement = node[0];
				return node[0];
			} else {
				node.setAttribute('mc', NativeVirtual.key);
				node.setAttribute('mc_context', service.context.id);
				NativeVirtual.controller = { global: global_st, local: local_st };
				MC.savedEvents(node);
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
				const micro_component = MC_Component.createEmptyElement(NativeVirtual.key);
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
				node[0].setAttribute('mc', NativeVirtual.key);
				NativeVirtual.controller = { global: global_st, local: local_st };
				NativeVirtual.HTMLElement = node[0];
				return node[0];
			} else {
				node.setAttribute('mc', NativeVirtual.key);
				NativeVirtual.controller = { global: global_st, local: local_st };
				NativeVirtual.HTMLElement = node;
				MC.savedEvents(node);
				return node;
			}
		}
	}
}

class MC {
	static keys = [];
	static version = '0.7.0';
	static anonimCollection = new Set();
	static functionCollecton = new Set();
	static mc_events_global = new Map();
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

	static savedEvents(html) {
		function scanElement(element) {
		  const events = $._data(element, "events");
		  if (events) {
			Object.keys(events).forEach(type => {
			  events[type].forEach(eventObj => {
				MCEventManager.bind(element, type, eventObj.handler);
			  });
			});
			$(element).off();
		  }
		  $(element).children().each((_, child) => scanElement(child));
		  return element;
		}
	  
		scanElement(html);
		MCEventManager.deepRebind(html); // <-- После бинда сразу перевесить на себя (на случай если diff)
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
					MC.savedEvents(node);
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
					console.error('MC | Вход контекста для выпуска MC 7 заблокирован');
					console.warn('MC | Вы можете безопасно создать функциональные контейнеры, без контекста, в области видимости MC.functionCollecton');
					return;
					// заблокировать вход для контекста в выпуске 7
					//#region 
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
						const micro_component = MC_Component.createEmptyElement(NativeVirtual.key);
						NativeVirtual.controller = arg2;
						NativeVirtual.HTMLElement = micro_component;
						return micro_component;
					}

					if (node.length) {
						node[0].setAttribute('mc', NativeVirtual.key);
						NativeVirtual.controller = arg2;
						NativeVirtual.HTMLElement = node[0];
						return node[0];
					} else {
						node.setAttribute('mc', NativeVirtual.key);
						NativeVirtual.controller = { global: global_st, local: local_st };
						NativeVirtual.HTMLElement = node;
						return node;
					}
					//#endregion
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
						const micro_component = MC_Component.createEmptyElement(NativeVirtual.key);
						NativeVirtual.controller = dependencyAnon;
						NativeVirtual.HTMLElement = micro_component;
						return micro_component;
					}

					/**
					 * Посмотри запись event_id при формировании html, такое ощущение что не пишет в атрибуты событие в virtual
 					 */
					if (node.length) {
						node[0].setAttribute('mc', NativeVirtual.key);
						NativeVirtual.controller = dependencyAnon;
						NativeVirtual.HTMLElement = node[0];
						MC.savedEvents(node[0]);
						return node[0];
					} else {
						node.setAttribute('mc', NativeVirtual.key);
						NativeVirtual.controller = dependencyAnon;
						NativeVirtual.HTMLElement = node;
						MC.savedEvents(node);
						return node;
					}
				}
			}

			

			let resultCall = original$.apply(this, arguments);

			return resultCall;
		};

		return 'Добро пожаловать в MC.js!';
	}

	static old_savedEvents(html) {
		console.log('first')
		function scanElement(element) {
		  const events = $._data(element, "events");
		  if (events) {
			let mcId = $(element).attr("mc-event-id");
			if (!mcId) {
			  mcId = "mc-" + Math.random().toString(36).substr(2, 8);
			  $(element).attr("mc-event-id", mcId);
			}
	
			const clonedEvents = MCState.deepClone(events);
	
			if (!MC.mc_events_global.has(mcId)) {
			  MC.mc_events_global.set(mcId, clonedEvents);
			}
	
			$(element).off();
		  }
	
		  $(element).children().each((_, child) => scanElement(child));
		  return element;
		}

		scanElement(html);

		MC.rebindEvents();
	  }
	
	  static rebindEvents() {
		MC.mc_events_global.forEach((events, mcId) => {
		  Object.keys(events).forEach(eventType => {
			$(document).off(eventType, `[mc-event-id="${mcId}"]`); // Удаляем возможные дубли
			events[eventType].forEach(eventObj => {
			  $(document).on(eventType, `[mc-event-id="${mcId}"]`, eventObj.handler);
			});
		  });
		});
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