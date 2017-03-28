(function() {
    window.pluto = pluto

    // upgrade an element
    // NOTE this will be unnecessary with customElements
    function pluto(el) {
        return el instanceof Template
            ? el
            : Object.setPrototypeOf(el, Template.prototype)
    }

    // RenderFragment represents a single rendered template, along with its
    // state and hard-links to the elements it generated and owns, in order
    // to support re-rendering.
    //
    // NOTE we can't inherit directly from DocumentFragment. Instead, we use
    // this intemediate object that handles the rendering, while only exposing
    // its `render()` function on the returned DocumentFragment via `toDoc()`.
    class RenderFragment {
        constructor(tpl, tokens) {
            this.tpl = tpl
            this.tokens = tokens
        }

        _toDoc(doc) {
            doc.render = this.render.bind(this) // re-renders.
            return doc
        }

        renderRepeat(obj) {
            this._repeat.forEach(function (item, idx) {
                if (!this.children[idx]) {
                    // create the new sub-fragment
                    this.children[idx] = new RenderFragment(this._tpl)
                    this.children[idx]._repeat = null
                    // TODO: append it?
                }

                // and now render it.
                obj.item = item
                this.children[idx].render(obj)
            }, this)

            return this.toDoc()
        }

        render(obj) {
            var tokens = this.tokens
            var doc = new DocumentFragment()
            if (!this.children) {
                // first render
                doc = this.tpl.cloneNode(true).content
                var children = [].map.call(doc.children, function(child) {
                    return child
                })
                this.children = { children: children }
            }

            for (var i = 0 ; i < tokens.length ; i += 1) {
                var t = tokens[i]
                var el = getPath(this.children, t.path)
                var v = getPath(obj, t.name)
                if (!t.attr) {
                    el.textContent = v || ''
                } else if (v === undefined) {
                    el.removeAttribute(t.attr)
                } else {
                    el.setAttribute(t.attr, v)
                }
            }

            return doc
        }
    }

    class Template extends HTMLTemplateElement {

        setAttribute(k, v) {
            HTMLTemplateElement.prototype.setAttribute.apply(this, arguments)

            if (k === 'repeat') {
                this._repeat = v
            }
        }

        renderer() {
            this.compile()
            return new RenderFragment(this, this.tokens)
        }

        compile() {
            var tokens = []
            var elements = [{ el: this.content, path: [] }]
            while (elements.length > 0) {
                var { el, path } = elements.shift()

                // inner content token
                var name = tokenName(el.textContent || '')
                if (name) {
                    tokens.push({ name, path })
                }

                // attributes
                [].forEach.call(el.attributes || [], function(attr) {
                    var name = tokenName(attr.value)
                    if (name) {
                        tokens.push({ name, attr: attr.name, path })
                    }
                })

                if (el instanceof Template) {
                    tokens.push({ path, tpl: true })
                    // console.log('NESTED?', el)
                }

                // children, enqueue.
                [].forEach.call(el.children || [], function(el, i) {
                    elements.push({ el, path: path.concat(['children', i]) })
                    maybeUpgrade(el)
                })
            }

            this.tokens = tokens
        }
    }

    pluto.Template = Template
    pluto.RenderFragment = RenderFragment

    function maybeUpgrade(el) {
        if (el.matches('template[is="pluto-tpl"]')) {
            pluto(el) // auto-upgrade nested templates.
        }
    }

    // -- HELPER FUNCTIONS

    function empty(el) {
        while (el.children.length > 0) {
            el.removeChild(el.children[0])
        }
    }

    function toObj(obj) {
        if (obj instanceof NamedNodeMap) {
            // convinience for passing HTMLElement.attributes
            var map = obj
            obj = {}
            for (var i = 0; i < map.length; i += 1) {
                obj[map[i].name] = map[i].value
            }
        }

        return obj || {}
    }

    function tokenName(s) {
        return s
            && s[0] === '{'
            && s[1] === '{'
            && s[s.length - 1] === '}'
            && s[s.length - 2] === '}'
            ? s.slice(2, -2) : null
    }

    function getPath(obj, path) {
        if (!path || path.length === 0) {
            return obj
        }

        var path = Array.isArray(path) ? path : path.split('.')
        var v = obj
        for (var i = 0; v !== undefined && i < path.length; i += 1) {
            v = v[path[i]]
        }
        return v
    }
})()
