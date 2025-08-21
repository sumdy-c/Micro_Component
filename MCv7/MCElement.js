class MC_Element {
	constructor(html) {
		return this.getComponent(html);
	}

    setAttributes(component) {
        component.HTML.setAttribute('style', 'height: 0; width: 0; display: none;');
    }
	
    createEmptyElement() {
		const micro_component = document.createElement('mc');
		micro_component.setAttribute('style', 'height: 0; width: 0; display: none;');

		return micro_component;
	}

	getComponent(HTML) {
		return HTML;
	}
}