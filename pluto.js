(function() {
/**
 * PLUTO
 * Native HTML Template Rendering
 *
 *
 * The MIT License (MIT)
 * Copyright (c) 2013 Roi Avinoam
 *
 * Permission is hereby granted, free of charge, to any person obtaining a copy
 * of this software and associated documentation files (the "Software"), to deal
 * in the Software without restriction, including without limitation the rights
 * to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
 * copies of the Software, and to permit persons to whom the Software is
 * furnished to do so, subject to the following conditions:
 *
 * The above copyright notice and this permission notice shall be included in
 * all copies or substantial portions of the Software.
 *
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
 * OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
 * SOFTWARE.
 */
class Template extends HTMLTemplateElement {
    render(obj) {
        var compiled = this.compile()
        return new compiled.Renderer(compiled).render(obj)
    }

    compile() {
        var exprs = []
        var elements = [{ el: this.content, path: [] }]
        while (elements.length > 0) {
            var { el, path } = elements.shift()

            // inner content expressions
            if (el.nodeName === '#text') {
                var expr = isExpressions(el.textContent)
                if (expr) {
                    exprs.push({ expr, path })
                }
            }

            // attributes
            [].forEach.call(el.attributes || [], function(attr) {
                var expr = isExpressions(attr.value)
                if (expr !== null) {
                    attr = attr.name
                    var evName, prop
                    if (attr.startsWith('on-')) {
                        evName = attr.slice(3)
                    } else {
                        prop = snakeToCamelCase(attr)
                    }
                    exprs.push({ expr, path, attr, evName, prop })
                }
            }, this)

            // children, enqueue.
            el.childNodes.forEach(function(el, i) {
                maybeUpgrade(el)
                var subpath = path.concat(['childNodes', i])
                if (el instanceof Template) {
                    exprs.push({ path: subpath, tpl: true })
                    return
                }

                elements.push({ el, path: subpath })
            })
        }

        // remove attributes or expressions before rendering in order to hide
        // the placeholder expressions from the constructor of custom elements.
        var clone = this.cloneNode(true)
        exprs.forEach(function(expr) {
            var el = select(clone.content, expr.path)
            if (!expr.attr) {
                el.textContent = ''
            } else {
                el.removeAttribute(expr.attr)
            }
        }, this)

        var repeat = this.getAttribute('repeat')
        if (repeat) {
            clone.repeat = compileExpressions([{ expr: repeat }])
        }

        var cond = this.getAttribute('if')
        if (cond) {
            clone.cond = compileExpressions([{ expr: cond }])
        }

        // we opt to compile the repeat/cond expressions separately than the
        // rest of this template - because (a) the template might relay on a
        // repeated ${item} property that doesn't yet exist in the repeat
        // expression, and (b) it's must smaller/faster than the complete
        // expressions list.
        // NB: It might not be that beneficial for cond though.
        clone.exprs = Object.assign(exprs, { eval: compileExpressions(exprs) })

        if (cond) {
            clone.Renderer = CondRenderer
        } else if (repeat) {
            clone.Renderer = RepeatRenderer
        } else {
            clone.Renderer = Renderer
        }

        return clone
    }
}

class Renderer {
    constructor(tpl) {
        this.tpl = tpl
        this.exprs = tpl.exprs
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

        // generate hard links from expressions to the generated elements in
        // order to avoid re-computing them on every render.
        var deferred = []
        this.paths = this.exprs.reduce(function (paths, expr, idx) {
            var el = select(doc, expr.path)

            if (expr.tpl) {
                var subdoc = pluto(el).render(obj)

                // we can't just replace right now becuase it will break
                // the path of the following iterations - defer it for later
                deferred.push(el.replaceWith.bind(el, subdoc))
                el = subdoc
            }

            paths[idx] = { el }

            // mark observed attributes
            if (expr.attr && el.attributeChangedCallback) {
                var observed = el.constructor.observedAttributes || [];
                paths[idx].observed = observed.indexOf(expr.attr) !== -1
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

        var values = this.exprs.eval(obj)
        for (var i = 0 ; i < this.exprs.length ; i += 1) {
            var expr = this.exprs[i]
            var { el, observed, listener } = this.paths[i]
            var v = values[i]

            // nested template
            if (expr.tpl) {
                el.render(obj)
                continue
            }

            // event handlers
            if (expr.evName) {
                if (listener) {
                    el.removeEventListener(expr.evName, listener)
                }

                if (typeof v === 'function') {
                    v = v._bound || v
                    el.addEventListener(expr.evName, v)
                    this.paths[i].listener = v // remember it for next render
                }

                continue
            }

            // handle flat text
            if (!expr.attr) {
                el.textContent = v || ''
                continue
            }

            // set attributes
            if (v === undefined) {
                el[expr.attr] = undefined
                el.removeAttribute(expr.attr)
            } else if (typeof v !== 'string' && observed) {
                el[expr.attr] = v
                el.attributeChangedCallback(expr.attr, null, v, null)
            } else {
                el[expr.attr] = v
                if (expr.attr === 'class' && typeof v === 'object') {
                    if (Array.isArray(v)) {
                        return v.join(' ')
                    }

                    v = Object.keys(v).filter(function (k) {
                        return v[k]
                    }).join(' ')
                } else if (expr.attr === 'style' && typeof v === 'object') {
                    v = Object.keys(v).map(function(k) {
                        return k + ': ' + v[k]
                    }).join('; ')
                }

                v = v.toString()
                if (v.startsWith('[object ')) {
                    el.removeAttribute(expr.attr)
                } else {
                    el.setAttribute(expr.attr, v)
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
        this.exprs = tpl.exprs
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

        var items = this.repeat(obj)[0]
        var item = obj.item
        if (!Array.isArray(items) && typeof items === 'object') {
            items = Object.keys(items).map(function(k) {
                return { key: k, value: items[k] }
            })
        }

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
        this.exprs = tpl.exprs
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

        var cond = this.cond(obj)[0] || false
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


// Searches for an element from root based on the property-path to the child
// example: root = <body>, path = childNodes.3.childNode.7. Resolved by walking
// the path down to the child.
function select(root, path) {
    var current = root
    for (var i = 0; current !== undefined && i < path.length; i += 1) {
        current = current[path[i]]
    }
    return current
}

const SNAKE_RE = /-([a-z])/g
function snakeToCamelCase(s) {
    return s.replace(SNAKE_RE, g => g[1].toUpperCase())
}

// extract expressions in template-literal syntax out of a string
var EXPR_RE = /\$\{[^\}]*\}/
function isExpressions(s) {
    return EXPR_RE.test(s) ? s : null
}

// compile a list of template-literal expressions into a function that evaluates
// these expression for the provided input object
function compileExpressions(exprs) {
    var refs = []
    var code = 'this.__plutoT || (this.__plutoT = T.bind(this));\n'
    code += exprs.map(function(expr, i) {
        if (expr.expr) {
            refs = refs.concat(getIdentifiers(expr.expr))
        }

        return `arguments[0][${i}] = this.__plutoT\`${expr.expr}\``
    }).join(';\n')

    var keys = refs.reduce((keys, k) => (keys[k] = true, keys), {})
    var fn = null
    return function(obj) {
        // check if the expressions function needs to be re-evaluated - only
        // when new keys exists on the input object that needs to be evaluated
        // as local variables. Generally - as long as the object doesn't add new
        // keys on every rerender, the function will be reevaluated infrequently
        // TODO: Might not work for HTMLElement objects
        var reEval = Object.keys(obj).reduce(function (reEval, k) {
            return keys[k] ? reEval : (keys[k] = true)
        }, fn === null)

        if (reEval) {
            var locals = `var { ${Object.keys(keys)} } = this`
            fn = eval('(function () {\n' + locals + '\n' + code + '\n})')
        }

        var res = []
        try {
            fn.call(obj, res)
        } catch (e) {
            console.warn(fn)
            throw e
        }

        return res
    }

    function T(s, v) {
        if (arguments.length > 2 || typeof v === 'string') {
            return String.raw.apply(null, arguments)
        }

        if (typeof v === 'function' && this[v.name] === v) {
            if (v._plutoBound !== this) {
                v._plutoBound = v.bind(this)
            }
            return v._plutoBound
        }

        return v
    }
}

// generate the list of identifiers found in the code.
function getIdentifiers(expr) {
    var re = /[$A-Z_][0-9A-Z_$]*/ig
    var whitespace = ' \n\r\t'
    var disallowed = '\'\".'

    // We first match for the valid identifier, and then check the previous
    // non-whitespace character preceeding the identifier to verify that it's
    // not a string or nested element.
    var refs = {}
    var match
    while (match = re.exec(expr)) {
        var lastChar = undefined
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

            if (window[match[0]] !== undefined) {
                continue // keep global functions (Object, Array, etc.)
            }

            refs[match[0]] = true
        }
    }

    delete refs.$
    return Object.keys(refs)
}


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

pluto.Template = Template
pluto.Renderer = Renderer
pluto.CondRenderer = CondRenderer
pluto.RepeatRenderer = RepeatRenderer
window.pluto = pluto
})();

(function() {

    // placed here in order to have its own scope clear of any of the pluto
    // local variables.
    pluto._eval = function(code) {
        return eval(code)
    }
})();
