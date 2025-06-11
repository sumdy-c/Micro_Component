class MCDifference {
	static KEY_ATTR = 'data-diffkey'; // Атрибут для ключей

	/**
	 * Основной метод сравнения
	 * @param {Node} oldNode - Исходный узел
	 * @param {Node} newNode - Новый узел
	 * @returns {Batch[]} - Список изменений
	 */
	static diff(oldNode, newNode) {
		const trace = [];
		this._compareNodes(oldNode, newNode, trace);
		return trace;
	}
	
	/**
	 * Основной метод сравнения и применения изменений
	 * @param {Node} oldNode - Исходный узел
	 * @param {Node} newNode - Новый узел
	 * @returns {Node} - Актуальная ссылка на измененный узел
	 */
	static diffAndApply(oldNode, newNode) {
		const trace = this.diff(oldNode, newNode);
		const node = this.apply(trace, oldNode);
		return node;
	}

	/**
	 * Применение изменений с отслеживанием корневого узла
	 * @param {Batch[]} trace - Список изменений
	 * @param {Node} rootNode - Исходный корневой узел
	 * @returns {Node} - Актуальный корневой узел
	 */
	static apply(trace, rootNode) {
		let currentNode = rootNode;

		trace.forEach((batch) => {
			const { target, changes } = batch;

			changes.forEach((change) => {
				switch (change.type) {
					case 'REPLACE':
						const newElement = change.node.cloneNode(true);
						target.replaceWith(newElement);
						MCEventManager.deepRebind(newElement);
						// Обновляем ссылку если заменяли корневой элемент
						if (target === currentNode) {
							currentNode = newElement;
						}
						break;

					case 'ATTR':
						Object.entries(change.attributes).forEach(([name, value]) => {
							if (value === null) target.removeAttribute(name);
							else target.setAttribute(name, value);
						});
						break;

					case 'TEXT':
						target.textContent = change.content;
						break;

					case 'REORDER':
						this._applyReorder(target, change.children);
						break;

					case 'REMOVE':
						MCEventManager.deepUnbind(target);
						if (target.parentNode) {
							target.parentNode.removeChild(target);
						}
						break;

					case 'INSERT':
						MCEventManager.deepRebind(change.node);
						// Вставим в конец родительского элемента (можно улучшить с учетом порядка)
						target.appendChild(change.node.cloneNode(true));
						break;
				}
			});
		});

		return currentNode;
	}

	// Внутренние методы
	static _compareNodes(oldNode, newNode, trace) {
		// Разные типы узлов – заменить целиком
		if (oldNode.nodeType !== newNode.nodeType) {
			this._createBatch(trace, oldNode, 'REPLACE', { node: newNode });
			return;
		}

		// Сравнение текстовых узлов
		if (this._isTextNode(oldNode)) {
			this._diffTextContent(oldNode, newNode, trace);
			return;
		}

		// Сравнение элементов
		this._diffAttributes(oldNode, newNode, trace);
		this._diffChildren(oldNode, newNode, trace);
	}

	static _isTextNode(node) {
		return node.nodeType === Node.TEXT_NODE;
	}

	static _diffTextContent(oldNode, newNode, trace) {
		if (oldNode.textContent !== newNode.textContent) {
			this._createBatch(trace, oldNode, 'TEXT', { content: newNode.textContent });
		}
	}

	static _diffAttributes(oldNode, newNode, trace) {
		const attrs = {};
		const oldAttrs = oldNode.attributes || [];
		const newAttrs = newNode.attributes || [];

		// Добавленные/измененные
		Array.from(newAttrs).forEach((attr) => {
			if (oldNode.getAttribute(attr.name) !== attr.value) {
				attrs[attr.name] = attr.value;
			}
		});

		// Удаленные
		Array.from(oldAttrs).forEach((attr) => {
			if (!newNode.hasAttribute(attr.name)) {
				attrs[attr.name] = null;
			}
		});

		if (Object.keys(attrs).length > 0) {
			this._createBatch(trace, oldNode, 'ATTR', { attributes: attrs });
		}
	}

	static _diffChildren(oldParent, newParent, trace) {
		const oldChildrenArr = Array.from(oldParent.childNodes);
		const newChildrenArr = Array.from(newParent.childNodes);

		// Если оба пустые – делать ничего не нужно
		if (oldChildrenArr.length === 0 && newChildrenArr.length === 0) return;

		// Если нет ключей, работаем по позициям (простое сравнение)
		const hasKeys = oldChildrenArr.some((c) => this._getKey(c)) || newChildrenArr.some((c) => this._getKey(c));
		if (!hasKeys) {
			const len = Math.max(oldChildrenArr.length, newChildrenArr.length);
			for (let i = 0; i < len; i++) {
				const oldChild = oldChildrenArr[i];
				const newChild = newChildrenArr[i];
				if (oldChild && newChild) {
					this._compareNodes(oldChild, newChild, trace);
				} else if (oldChild && !newChild) {
					this._createBatch(trace, oldChild, 'REMOVE');
				} else if (!oldChild && newChild) {
					this._createBatch(trace, oldParent, 'INSERT', { node: newChild });
				}
			}
			return;
		}

		// Если есть ключи, используем их
		const oldChildren = this._getKeyedChildren(oldParent);
		const newChildren = this._getKeyedChildren(newParent);
		const moves = [];

		// Удаление отсутствующих
		oldChildren.forEach((child, key) => {
			if (!newChildren.has(key)) {
				this._createBatch(trace, child.node, 'REMOVE');
			}
		});

		// Добавление/перемещение/обновление
		let lastIndex = 0;

		newChildren.forEach((newChild, key) => {
			const oldChild = oldChildren.get(key);

			if (!oldChild) {
				this._createBatch(trace, oldParent, 'INSERT', { node: newChild.node });
			} else {
				this._compareNodes(oldChild.node, newChild.node, trace);
				if (oldChild.index !== newChild.index) {
					moves.push({ node: oldChild.node, index: newChild.index });
				}
				lastIndex = newChild.index;
			}
		});

		// Обработка перемещений
		if (moves.length > 0) {
			this._createBatch(trace, oldParent, 'REORDER', { children: moves });
		}
	}

	static _applyReorder(parent, moves) {
		// moves: [{node, index}]
		const nodes = Array.from(parent.childNodes);
		const nodeMap = new Map(nodes.map((n, idx) => [n, idx]));
		moves
			.sort((a, b) => a.index - b.index)
			.forEach(({ node, index }) => {
				let refNode = parent.childNodes[index] || null;
				if (node !== refNode) {
					parent.insertBefore(node, refNode);
				}
			});
	}

	static _getKey(node) {
		if (node.nodeType !== Node.ELEMENT_NODE) return null;
		return node.getAttribute(this.KEY_ATTR);
	}

	static _getKeyedChildren(parent) {
		const map = new Map();
		Array.from(parent.childNodes).forEach((child, index) => {
			let key = this._getKey(child);
			if (key == null) key = index; // fallback если нет ключа
			map.set(key, { node: child, index });
		});
		return map;
	}

	static _createBatch(trace, target, type, payload = {}) {
		trace.push({
			target,
			changes: [{ type, ...payload }],
		});
	}
}