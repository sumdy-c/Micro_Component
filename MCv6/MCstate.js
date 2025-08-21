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