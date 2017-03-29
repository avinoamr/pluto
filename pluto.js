(function() {
    window.pluto = pluto

    // upgrade an element
    // NOTE this will be unnecessary with customElements
    function pluto(el) {
        return el instanceof Template
            ? el
            : Object.setPrototypeOf(el, Template.prototype)
    }

    class Renderer {
        constructor(tpl, doc) {
            this.tokens = tpl.tokens

            doc.appendChild(tpl.cloneNode(true).content)

            // generate hard links from tokens to the generated elements in
            // order to avoid re-computing them on every render.
            this.paths = tpl.tokens.reduce(function (paths, t) {
                return paths[t.path] = getPath(doc, t.path), paths
            }, {})

            // copy the list of generated elements from the template in order
            // to support removals
            this.children = [].map.call(doc.children, child => child)
        }

        render(obj) {
            for (var i = 0 ; i < this.tokens.length ; i += 1) {
                var t = this.tokens[i]
                var el = this.paths[t.path]
                var v = getPath(obj, t.name)

                // nested template
                if (t.tpl) {
                    continue
                }

                if (!t.attr) {
                    el.textContent = v || ''
                } else if (v === undefined) {
                    el.removeAttribute(t.attr)
                } else {
                    el.setAttribute(t.attr, v)
                }
            }
        }
    }

    class Template extends HTMLTemplateElement {
        render(obj) {
            this.compile()

            var doc = new DocumentFragment()
            var renderer = new Renderer(this, doc)
            doc.render = (obj) => (renderer.render(obj), doc)
            return doc.render(obj)
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
                }

                // children, enqueue.
                [].forEach.call(el.children || [], function(el, i) {
                    maybeUpgrade(el)
                    var subpath = path.concat(['children', i])
                    if (el instanceof Template) {
                        tokens.push({ path: subpath, tpl: true })
                        return
                    }

                    elements.push({ el, path: subpath })
                })
            }

            this.tokens = tokens
            this.repeat = tokenName(this.getAttribute('repeat'))
            this.if = tokenName(this.getAttribute('if'))
        }
    }

    pluto.Template = Template

    // -- HELPER FUNCTIONS

    function placeholder() {
        var el = document.createElement('template')
        el.setAttribute('is', 'pluto-placeholder')
        el.replaceWith = function(el) {
            return this.parentNode.replaceChild(el, this)
        }
        return el
    }

    function maybeUpgrade(el) {
        if (el.matches('template[is="pluto-tpl"]')) {
            pluto(el) // auto-upgrade nested templates.
        }
    }

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
