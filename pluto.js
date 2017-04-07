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

    class Template extends HTMLTemplateElement {
        render(obj) {
            var compiled = this.compile()
            return new compiled.Renderer(compiled).render(obj)
        }

        compile() {
            var tokens = []
            var elements = [{ el: this.content, path: [] }]
            while (elements.length > 0) {
                var { el, path } = elements.shift()

                // inner content token
                if (el.nodeName === '#text') {
                    var name = this.tokenName(el.textContent || '')
                    if (name !== null) {
                        tokens.push({ name, path })
                    }
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
                el.childNodes.forEach(function(el, i) {
                    maybeUpgrade(el)
                    var subpath = path.concat(['childNodes', i])
                    if (el instanceof Template) {
                        tokens.push({ path: subpath, tpl: true })
                        return
                    }

                    elements.push({ el, path: subpath })
                })
            }

            // remove attributes or tokens before rendering in order to hide
            // the placeholder tokens from the constructor of custom elements.
            var clone = this.cloneNode(true)
            tokens.forEach(function(t) {
                var el = getPath(clone.content, t.path)
                if (!t.attr) {
                    el.textContent = ''
                } else {
                    el.removeAttribute(t.attr)
                }
            }, this)

            clone.tokens = tokens
            clone.repeat = this.tokenName(this.getAttribute('repeat'))
            clone.cond = this.tokenName(this.getAttribute('if'))

            if (clone.cond) {
                clone.Renderer = CondRenderer
            } else if (clone.repeat) {
                clone.Renderer = RepeatRenderer
            } else {
                clone.Renderer = Renderer
            }

            return clone
        }

        tokenName(s) {
            var name = s
                && ( s = s.trim() )
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
            var doc = document.importNode(this.tpl.content, true)
            doc.render = (obj) => (this.render(obj), doc)
            doc.remove = () => this.remove()

            // generate hard links from tokens to the generated elements in
            // order to avoid re-computing them on every render.
            var deferred = []
            this.paths = this.tokens.reduce(function (paths, t, idx) {
                var el = getPath(doc, t.path)
                if (t.tpl) {
                    var subdoc = pluto(el).render(obj)

                    // we can't just replace right now becuase it will break
                    // the path of the following iterations - defer it for later
                    deferred.push(el.replaceWith.bind(el, subdoc))
                    el = subdoc
                }

                paths[idx] = { el }

                // mark observed attributes
                if (t.attr && el.attributeChangedCallback) {
                    var observed = el.constructor.observedAttributes || [];
                    paths[idx].observed = observed.indexOf(t.attr) !== -1
                }

                return paths
            }, {})

            // run all of the deferred replacements
            deferred.forEach(fn => fn())


            // copy the list of generated elements from the template in order
            // to support removals
            this.children = [].map.call(doc.childNodes, child => child)

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

                // handle flat text
                if (!t.attr) {
                    el.textContent = v || ''
                    continue
                }

                // event handlers
                if (t.attr.startsWith('on-')) {
                    var evName = t.attr.slice(3)
                    if (listener) {
                        el.removeEventListener(evName, listener)
                    }

                    if (typeof v === 'function') {
                        v = v._bound || v
                        el.addEventListener(evName, v)
                        this.paths[i].listener = v // remember it for next render
                    }

                    continue
                }

                // set attributes
                if (v === undefined) {
                    el[t.attr] = undefined
                    el.removeAttribute(t.attr)
                } else if (typeof v !== 'string' && observed) {
                    el[t.attr] = v
                    el.attributeChangedCallback(t.attr, null, v, null)
                } else {
                    el[t.attr] = v
                    if (t.attr === 'class' && typeof v === 'object') {
                        if (Array.isArray(v)) {
                            return v.join(' ')
                        }

                        v = Object.keys(v).filter(function (k) {
                            return v[k]
                        }).join(' ')
                    } else if (t.attr === 'style' && typeof v === 'object') {
                        v = Object.keys(v).map(function(k) {
                            return k + ': ' + v[k]
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

            this.placeholder = document.createTextNode('')
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

            this.placeholder = document.createTextNode('')
            doc.appendChild(this.placeholder)
            return doc
        }

        render(obj) {
            if (!this._doc) {
                this._doc = this.init()
            }

            var cond = getPath(obj, this.cond) || false
            if (cond && this.child) {
                this.child.render(obj)
            } else if (cond && !this.child) {
                var doc = new Renderer(this.tpl).render(obj)
                this.placeholder.before(doc)
                this.child = doc
            } else if (!cond && this.child) {
                this.child = this.child.remove()
            }

            return this._doc
        }
    }

    pluto.Template = Template
    pluto.Renderer = Renderer
    pluto.CondRenderer = CondRenderer
    pluto.RepeatRenderer = RepeatRenderer

    // -- HELPER FUNCTIONS

    function maybeUpgrade(el) {
        // don't match #text, #comment, etc.
        if (el.nodeName[0] !== '#' && el.matches('template')) {
            pluto(el) // auto-upgrade nested templates.
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
        } else if (path === 'this') {
            return obj
        }

        if (path.expr) {
            try {
                return path.fn.call(obj)
            } catch (err) {
                console.warn(err.message, 'in:', path.expr)
                return undefined
            }
        }

        var path = Array.isArray(path) ? path : path.split('.')
        var v = obj
        var bound = null
        for (var i = 0; v !== undefined && i < path.length; i += 1) {
            bound = v
            v = v[path[i]]
        }

        if (typeof v === 'function') {
            // may cause event listeners to re-register un-necessarily
            v._bound = v.bind(bound)
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
