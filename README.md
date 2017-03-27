# pluto
Native HTML Template Rendering

## Render repeat algorithm: `tpl.renderRepeat(obj)`

- obj <- INPUT
- state <- INPUT or empty document
- let items = `getPath(obj, this._repeat)`
- for item, idx in items
    - let doc = state[idx]
    - if doc exists
        - state[idx] = doc.render() // re-render it.
    - otherwise,
        - state[idx] = this.render(item) // new item
- for item, idx in state
    - if it's newly added - add it also to the dom
    - if idx > items.length - remove it from the dom and from state
- return state


## Open Design Questions

- What if a user changes the DOM - like removing items - and then re-renders?
    - do we want to re-add the missing items?
    - do we want to just render the remaining items?
    - not supported or undefined behavior
