(function() {
    window.pluto = pluto

    // upgrade an element
    // NOTE this will be unnecessary with customElements
    function pluto(el) {
        return el instanceof Template
            ? el
            : Object.setPrototypeOf(el, Template.prototype)
    }

    class Template extends HTMLTemplateElement {
        render(obj) {
            this.compile()

            // initial render on the clone of this template before importing it
            // because otherwise it will start firing custom-elements reactions
            // (createdCallback) before all of the attributes are set.
            var clone = this.cloneNode(true)
            this._render(this.tokens, obj, clone.content)

            // NOTE: Yeah, it does mean that we clone it twice. Alternatively,
            // (1) we can opt to render on the template itself, but this will
            // reveal the rendered template and will make it impossible to make
            // dynamic changes and then re-compile. (2) we can create a clone
            // just once as using it a scratch space.
            return document.importNode(clone.content, true)
        }

        // actual rendering into an element or document fragment
        _render(tokens, obj, into) {
            var subtpls = []

            // first pass - subsitution
            for (var i = 0 ; i < tokens.length ; i += 1) {
                var t = tokens[i]
                var el = getPath(into, t.path)
                if (t.tpl) {
                    subtpls.push(el)
                    continue
                }

                var v = getPath(obj, t.name)
                if (!t.attr) {
                    el.textContent = v || ''
                } else if (v === undefined) {
                    el.removeAttribute(t.attr)
                } else {
                    el.setAttribute(t.attr, v)
                }
            }

            // TODO compute hard-links before messing up the elements order

            // second pass - sub-templates
            for (var i = 0; i < subtpls.length; i += 1) {
                var tpl = subtpls[i]
                into.insertBefore(pluto(tpl).render(obj), tpl.nextSibling)
            }
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
                    if (el.matches('template[is="pluto-tpl"]')) {
                        pluto(el) // auto-upgrade nested templates.
                    }
                })
            }

            this.tokens = tokens
        }
    }

    pluto.Template = Template


    // -- HELPER FUNCTIONS

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
        while (v !== undefined && path.length > 0) {
            v = v[path.shift()]
        }
        return v
    }
})()
