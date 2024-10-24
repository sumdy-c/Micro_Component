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
	 *
	 * @param {} stateParam
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

	set(value) {
		if(MC.MC_setting.controlled && JSON.stringify(value) === JSON.stringify(this.value)) {
			return;
		}

		if (this.passport) {
			this.value = value;
			this.passport.value = this.value;
		}
	}

	get() {
		return JSON.parse(JSON.stringify(this.value));
	}
}