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
