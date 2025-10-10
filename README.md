# MC (Micro Component)

MC (Micro Component) is a JavaScript framework plugin library that extends jQuery by providing seamless reactivity. It enables the creation of modular components and reactive UI logic in legacy jQuery applications, simplifying the development of dynamic, interactive features. MC offers a component/hook-style API (similar to modern frameworks) without additional dependencies. This makes it easy to gradually add reactivity to existing jQuery-based projects.

## Docs: 
see the <a href ='https://sumdy-c.github.io/MC_Documentation/'>documentation</a> for a full understanding of the installation!

## Key Features
- **Seamless jQuery integration:** MC works alongside your current jQuery code. You include it *after* jQuery and then use `$`-style component mounting or its static API (no build step required).
- **Lightweight and modular:** The entire MC library is very small (only ~11KB minified) and provides component-based structure. You can split UI into reusable components or functions without rewriting your app.
- **Reactive state management:** MC adds simple reactive state to jQuery. In class-based components you use `super.state()` to create proxy-based state; in function components you use hooks like `MC.uState()` (which caches state across renders).
- **Hooks-style API:** For functional components, MC provides familiar hooks such as `$.MC.effect()`, `$.MC.memo()`, and `MC.uContext()`.
- **Declarative rendering:** Components define their UI via jQuery element builders. MC automatically re-renders affected parts of the DOM when state changes. This lets you declaratively describe interfaces without manual DOM updates.
- **Well-documented:** The project includes examples and documentation (on GitHub and in this README) to guide a smooth developer experience.

## Installation

### npm
```bash
npm install jquery-micro_component
```
Then include it:
```html
<script src="path/to/jquery.min.js"></script>
<script src="node_modules/jquery-micro_component/MC.min.js"></script>
```

### Manual
Download `MC.min.js` and include it manually after jQuery.

## Quick Start
```html
<!DOCTYPE html>
<html>
<head>
  <script src="https://code.jquery.com/jquery-3.6.0.min.js"></script>
  <script src="https://cdn.jsdelivr.net/npm/jquery-micro_component@0.7.0/MC.min.js"></script>
  <script>MC.init();</script>
  <script>
    document.addEventListener("DOMContentLoaded", () => {
      class App extends MC {
          constructor() {
              super();
          }
      
          render() {
            return $('<div>').text('APP!');
          }
      }

      $('#app').append($.MC(App))
    });
  </script>
</head>
<body>
  <div id="app"></div>
</body>
</html>
```

## Example Usage

### Functional Component Style
```js

function Counter(props) {
  const [count, setCount] = MC.uState(props.initial || 0);
  
  return $('<div>').append(
    $('<button>').text('+').on('click', () => setCount(count + 1)),
    $('<span>').text(` Count: ${count}`)
  );
}

MC.use(Counter, MC.Props({ props: { initial: 0 } }), '#app');
```

### Class-based Component Style
```js
class Button extends MC {
  render(_, { text, event }) {
    return $('<button>').text(text).on('click', event);
  }
}

class TodoApp extends MC {
  constructor() {
    super();
    this.todos = super.state([]);
    this.inputValue = '';
  }

  addTodo() {
    if (this.inputValue.trim()) {
      const list = this.todos.get();
      list.push(this.inputValue.trim());
      this.inputValue = '';
      this.todos.set(list);
    }
  }
  
  deleteTodo(i) {
    const list = this.todos.get();
    list.splice(i, 1);
    this.todos.set(list);
  }

  render(state) {
    const [todos] = state.local;
    
    return $('<div>').append(
      
        $('<input>').val(this.inputValue).on('input', e => this.inputValue = e.target.value),
      
        $.MC(Button, { text: 'Add', event: () => this.addTodo()}),
      
        $('<div>').append(
            todos.map((task, i) =>
                $('<div>').append(
                    $('<span>').text(task + ' '),
                    $.MC(Button, { text: 'Delete', event: () => this.deleteTodo(i)}),
                )
            )
        )
    );
  }
}

$('#app').append($.MC(TodoApp));
```

## API Reference

- **MC.init()** — Initialize MC once per page..
- **$.MC.effect()** — Hook for side effects.
- **$.MC.memo()** — Memoize expensive computations.
- **super.state() ( in MC comp )** — Create reactive state in class components.
- **MC.uState()** —  Alternative global handler.
- **MC.uContext()** — Consume shared context values.

## Compatibility

- Requires **jQuery 1.x**
- Works in all modern browsers supporting Proxy.
- No build tools or JSX required.

## Contributing

Pull requests and issues are welcome on [GitHub](https://github.com/sumdy-c/Micro_Component).

## License

Released under the **MIT License**.
