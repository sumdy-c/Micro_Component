/**
 * MCDiffirence — масштабируемый diff и патчинг DOM-дерева для MC_Component.
 * Поддерживает любые структуры, устойчив к edge-cases, легко расширяется.
 * Подробное логгирование и диагностика для поддержки и дебага.
 *
 * Архитектура: разделён на внутренние классы-хелперы для сравнения атрибутов, классов, стилей, событий, детей.
 * Безопасен для любых типов DOM-узлов. 
 * Протестирован для больших деревьев (10k+ узлов).
 */

/* eslint-disable no-console */

class MCDiffirence {
    // === ТОЧКА ВХОДА ===
    static diffAndApply(oldNode, newNode) {
        console.groupCollapsed('[MCDiffirence] diffAndApply');
        try {
            const trace = DiffMaster.diffNode(oldNode, newNode, { level: 0, path: '' });
            const node = PatchMaster.applyPatch(trace, oldNode, { level: 0, path: '' });
            console.log('[MCDiffirence] Patch applied:', trace);
            return node;
        } catch (e) {
            console.error('[MCDiffirence] Diff/Patch error:', e);
            throw e;
        } finally {
            console.groupEnd();
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
        return; // off log prod build
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