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
            // this._render(this.tokens, clone.content, obj)
            // this._render(this.tokens, clone.content, obj)

            // NOTE: Yeah, it does mean that we clone it twice. Alternatively,
            // (1) we can opt to render on the template itself, but this will
            // reveal the rendered template and will make it impossible to make
            // dynamic changes and then re-compile. (2) we can create a clone
            // just once as using it a scratch space.
            var doc = document.importNode(clone.content, true)

            this._render(this.tokens, doc, obj) // NOTE TEMPORARY.


            doc.render = this._rerender.bind(this, this.tokens, doc)
            return doc
        }

        _rerender(tokens, into, obj) {
            var data = into.data
            for (var i = 0 ; i < tokens.length ; i += 1) {
                var t = tokens[i]
                var el = data[t.path]

                if (t.tpl) {
                    el.render(obj)
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
        }

        _render(tokens, into, obj) {
            var data = {}
            var subdocs = []
            for (var i = 0 ; i < tokens.length ; i += 1) {
                var t = tokens[i]
                var el = getPath(into, t.path)
                data[t.path] = el

                if (t.tpl) {
                    var doc = pluto(el).render(obj)
                    doc.el = el
                    subdocs.push(doc)
                    data[t.path] = doc
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

            subdocs.forEach(function (doc) {
                into.insertBefore(doc, doc.el.nextSibling)
            })

            into.data = data
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
        for (var i = 0; v !== undefined && i < path.length; i += 1) {
            v = v[path[i]]
        }
        return v
    }
})()
