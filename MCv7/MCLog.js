class MCLog {
	/**
	 * Компонент подключенного логирования
	 */
	component;

	/**
	 * Компонент MC
	 * @param { unknown } component
	 * @returns
	 */
	constructor(component) {
		if (!component) {
			console.error(
				'Ошибка инициализации логирования для ресурсов MC.'
			);
			return;
		}

		this.component = component;
	}

	/**
	 * Лог ошибки для МС
	 * @param { string } title
	 * @param { Array<string> } textArray
	 */
	error(title, textArray) {
		const prefix = `[${this.component.constructor.name}]`;
		console.groupCollapsed(`%c${prefix} ${title}`, 'color: #ff5959; font-weight: bold;');
		for (const consoleText of textArray) {
			console.error(consoleText);
		}
		console.groupEnd();
	}

	/**
	 * Лог предупреждения для МС
	 * @param { string } title
	 * @param { Array<string> } textArray
	 */
	warn(title, textArray) {
		const prefix = `[${this.component.constructor.name}]`;
		console.groupCollapsed(`%c${prefix} ${title}`, 'color: #ff8500; font-weight: bold;');
		for (const consoleText of textArray) {
			console.warn(consoleText);
		}
		console.groupEnd();
	}
}
