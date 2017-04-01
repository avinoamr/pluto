(function() {
    window.pluto = pluto

    // upgrade an element
    // NOTE this will be unnecessary with customElements
    function pluto(el) {
        if (typeof el === 'string') {
            // support HTML-imported selections
            var doc = document._currentScript // used by pollyfills
                || document.currentScript // native.
                || document // not an import.
            el = (doc.ownerDocument || doc).querySelector(el)
        }

        return !el || el instanceof Template
            ? el
            : Object.setPrototypeOf(el, Template.prototype)
    }

    class Renderer {
        constructor(tpl) {
            this.tpl = tpl
            this.tokens = tpl.tokens
        }

        remove() {
            while (this.children.length > 0) {
                this.children.pop().remove()
            }
        }

        init(obj) {
            var doc = this.tpl.cloneNode(true).content

            // remove attributes or tokens before importing in order to hide
            // the placeholder tokens from the constructor of custom elements.
            this.tokens.forEach(function(t) {
                var el = getPath(doc, t.path)
                if (!t.attr) {
                    el.textContent = ''
                } else {
                    el.removeAttribute(t.attr)
                }
            })

            doc = document.importNode(doc, true) // this will upgrade elements
            doc.render = (obj) => (this.render(obj), doc)
            doc.remove = () => this.remove()

            // generate hard links from tokens to the generated elements in
            // order to avoid re-computing them on every render.
            this.paths = this.tokens.reduce(function (paths, t, idx) {
                var el = getPath(doc, t.path)
                if (t.tpl) {
                    var subdoc = pluto(el).render(obj)
                    el.replaceWith(subdoc)
                    el = subdoc
                }

                paths[idx] = { el }

                // marke observed attributes
                if (t.attr && el.attributeChangedCallback) {
                    var observed = el.constructor.observedAttributes || [];
                    paths[idx].observed = observed.indexOf(t.attr) !== -1
                }

                return paths
            }, {})

            // copy the list of generated elements from the template in order
            // to support removals
            this.children = [].map.call(doc.children, child => child)

            return doc
        }

        render(obj) {
            if (!this._doc) {
                this._doc = this.init(obj)
            }

            for (var i = 0 ; i < this.tokens.length ; i += 1) {
                var t = this.tokens[i]
                var { el, observed, listener } = this.paths[i]
                var v = getPath(obj, t.name)

                // nested template
                if (t.tpl) {
                    el.render(obj)
                    continue
                }

                if (!t.attr) {
                    el.textContent = v || ''
                } else if (v === undefined) {
                    el.removeAttribute(t.attr)
                } else if (typeof v === 'function' && t.attr.startsWith('on')) {
                    // set the event listener if it has changed
                    var evName = t.attr.slice(2)
                    if (listener) {
                        el.removeEventListener(evName, listener)
                    }

                    el.addEventListener(evName, v)
                    this.paths[i].listener = v // remember it for next render
                } else if (typeof v !== 'string' && observed) {
                    el.attributeChangedCallback(t.attr, null, v, null)
                } else {
                    if (t.attr === 'class' && typeof v === 'object') {
                        if (Array.isArray(v)) {
                            return v.join(' ')
                        }

                        v = Object.keys(v).filter(function (k) {
                            return v[k]
                        }).join(' ')
                    } else if (t.attr === 'style' && typeof v === 'object') {
                        v = Object.keys(v).map(function(k) {
                            return k + ': ' + v
                        }).join('; ')
                    }

                    v = v.toString()
                    if (v === '[object Object]') {
                        el.removeAttribute(t.attr)
                    } else {
                        el.setAttribute(t.attr, v)
                    }
                }
            }

            return this._doc
        }
    }

    class RepeatRenderer {
        constructor(tpl) {
            this.tpl = tpl
            this.children = []
            this.repeat = tpl.repeat
        }

        remove() {
            while (this.children.length > 0) {
                this.children.pop().remove()
            }
        }

        init() {
            var doc = new DocumentFragment()
            doc.render = (obj) => (this.render(obj), doc)
            doc.remove = () => this.remove()

            this.placeholder = placeholder()
            doc.appendChild(this.placeholder)

            return doc
        }

        render(obj) {
            if (!this._doc) {
                this._doc = this.init()
            }

            var item = obj.item
            var items = getPath(obj, this.repeat) || []

            // remove obsolete items
            while (this.children.length > items.length) {
                this.children.pop().remove()
            }

            // update existing items
            for (var i = 0; i < this.children.length; i += 1) {
                obj.item = items[i]
                this.children[i].render(obj)
            }

            // create new items
            while (this.children.length < items.length) {
                var i = this.children.length
                obj.item = items[i]
                var doc = new Renderer(this.tpl).render(obj)
                this.children.push(doc)
                this.placeholder.before(doc)
            }

            obj.item = item // restore previous item value.
            return this._doc
        }
    }

    class CondRenderer {
        constructor(tpl) {
            this.tpl = tpl
            this.child = null
            this.cond = tpl.cond
        }

        init() {
            var doc = new DocumentFragment()
            doc.render = (obj) => (this.render(obj), doc)

            this.placeholder = placeholder()
            doc.appendChild(this.placeholder)
            return doc
        }

        render(obj) {
            if (!this._doc) {
                this._doc = this.init()
            }

            var cond = getPath(obj, this.cond) || false
            if (cond && !this.child) {
                var doc = new Renderer(this.tpl).render(obj)
                this.placeholder.before(doc)
                this.child = doc
            } else if (!cond && this.child) {
                this.child = this.child.remove()
            }

            return this._doc
        }
    }

    class Template extends HTMLTemplateElement {
        render(obj) {
            this.compile()
            return new this.Renderer(this).render(obj)
        }

        compile() {
            if (this._compiled === this.outerHTML) {
                return // already compiled.
            }
            this._compiled = this.outerHTML

            var tokens = []
            var elements = [{ el: this.content, path: [] }]
            while (elements.length > 0) {
                var { el, path } = elements.shift()

                // inner content token
                var name = this.tokenName(el.textContent || '')
                if (name !== null) {
                    tokens.push({ name, path })
                }

                // attributes
                [].forEach.call(el.attributes || [], function(attr) {
                    var name = this.tokenName(attr.value)
                    if (name !== null) {
                        tokens.push({ name, attr: attr.name, path })
                    }
                }, this)

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
            this.repeat = this.tokenName(this.getAttribute('repeat'))
            this.cond = this.tokenName(this.getAttribute('if'))

            if (this.cond) {
                this.Renderer = CondRenderer
            } else if (this.repeat) {
                this.Renderer = RepeatRenderer
            } else {
                this.Renderer = Renderer
            }
        }

        tokenName(s) {
            var name = s
                && s[0] === '{'
                && s[1] === '{'
                && s[s.length - 1] === '}'
                && s[s.length - 2] === '}'
                ? s.slice(2, -2).trim() : null

            // normal identifier
            if (!name || name.match(isIdentifier)) {
                return name
            }

            // it's probably a javascript expression
            return { expr: name, fn: this.evalExpr(name) }
        }

        evalExpr(expr) {
            var re = /[$A-Z_][0-9A-Z_$]*/ig
            var whitespace = ' \n\r\t'
            var disallowed = '\'\".'

            // generate the list of identifiers found in the code. We first match
            // for the valid identifier, and then check the previous non-whitespace
            // character preceeding the identifier to verify that it's not a string
            // or nested element.
            var refs = {}
            var match
            while (match = re.exec(expr)) {
                var lastChar;
                do {
                    match.index -= 1
                    if (whitespace.indexOf(expr[match.index]) === -1) {
                        lastChar = expr[match.index]
                    }
                } while (match.index > -1 && !lastChar)

                if (disallowed.indexOf(lastChar) === -1) {
                    if (match[0] === 'this') {
                        continue // allow access to `this` for binding
                    }

                    refs[match[0]] = true
                }
            }

            // evaluate a function that sets all of the references found as local
            // variables and then executes the original expression.
            var code = Object.keys(refs).map(function (ref) {
                return 'var ' + ref + ' = this.' + ref
            }).join(';') + ' ; return ' + expr

            try {
                return pluto._eval('function _expr() {' + code + '}; _expr')
            } catch(err) {
                console.warn(err.message, 'in: {{', expr, '}}')
                return function () {}
            }
        }
    }

    pluto.Template = Template
    pluto.Renderer = Renderer
    pluto.CondRenderer = CondRenderer
    pluto.RepeatRenderer = RepeatRenderer

    // -- HELPER FUNCTIONS

    function placeholder() {
        var el = document.createElement('template')
        el.setAttribute('is', 'pluto-placeholder')
        return el
    }

    function maybeUpgrade(el) {
        if (el.matches('template')) {
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

    var isIdentifier = /^[$A-Z_][0-9A-Z_$\.]*$/i;

    function getPath(obj, path) {
        if (!path || path.length === 0) {
            return undefined
        }

        if (path.expr) {
            try {
                return path.fn.call(obj)
            } catch (err) {
                console.warn(err.message, 'in: ', path.expr)
                return undefined
            }
        }

        var path = Array.isArray(path) ? path : path.split('.')
        var v = obj
        for (var i = 0; v !== undefined && i < path.length; i += 1) {
            v = v[path[i]]
        }
        return v
    }
})();

(function() {

    // placed here in order to have its own scope clear of any of the pluto
    // local variables.
    pluto._eval = function(code) {
        return eval(code)
    }
})();
