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

            this._repeat = tokenName(tpl.getAttribute('repeat'))
        }

        _renderable(obj) {
            obj.render = this.render.bind(this)
            return obj
        }

        remove() {
            this.children.forEach(function(child) {
                child.remove()
            })
        }

        renderRepeat(obj) {
            var repeat = getPath(obj, this._repeat) || []
            if (!this.doc || !this.children) {
                this.placeholder = document.createElement('template')
                this.placeholder.setAttribute('is', 'pluto-placeholder')
                this.doc = new DocumentFragment()
                this.doc.appendChild(this.placeholder)
                this.children = []
            }

            // remove elements
            while (this.children.length > repeat.length) {
                this.children.pop().remove()
            }

            // add new elements
            while (this.children.length < repeat.length) {
                var child = new RenderFragment(this.tpl, this.tokens)
                child._repeat = null
                this.children.push(child)
            }

            repeat.forEach(function (item, idx) {
                var child = this.children[idx]
                obj.item = item
                var doc = child.render(obj)
                this.placeholder.parentNode.insertBefore(doc, this.placeholder)
            }, this)

            return this._renderable(this.doc)
        }

        render(obj) {
            if (this._repeat) {
                return this.renderRepeat(obj)
            }

            var tokens = this.tokens
            if (!this.doc || !this.children) {
                this.doc = this.tpl.cloneNode(true).content
                this.children = [].map.call(this.doc.children, (child) => child)
            }

            for (var i = 0 ; i < tokens.length ; i += 1) {
                var t = tokens[i]
                var el = getPath(this, t.path)
                var v = getPath(obj, t.name)
                if (!t.attr) {
                    el.textContent = v || ''
                } else if (v === undefined) {
                    el.removeAttribute(t.attr)
                } else {
                    el.setAttribute(t.attr, v)
                }
            }

            return this._renderable(this.doc)
        }
    }

    class Template extends HTMLTemplateElement {

        setAttribute(k, v) {
            HTMLTemplateElement.prototype.setAttribute.apply(this, arguments)

            if (k === 'repeat') {
                this._repeat = v
            }
        }

        render(obj) {
            this.compile()
            return new RenderFragment(this, this.tokens).render(obj)
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
