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
        var compiled = this._compiled || (this._compiled = {})
        if (compiled.html !== this.innerHTML) { // recompile
            // console.log('RECOMPILE', this) // bad - nested cloned templates are re-compiled on every item
            var content = this.cloneNode(true).content
            Object.assign(compiled, this.compile(content), {
                html: this.innerHTML
            })
        }

        var { content, exprs, items } = compiled
        return new Renderer(content, exprs, items).render(obj)
    }

    _renderIn(obj, el) {
        if (el.__plutoRenderer) {
            el.__plutoRenderer.render(obj)
        } else {
            var doc = this.render(obj)
            el.replaceWith(doc)
            el.__plutoRenderer = doc
            el.remove = doc.remove.bind(doc)
        }
    }

    compile(content) {
        if (content.nodeName !== '#document-fragment') {
            var doc = new DocumentFragment()
            doc.appendChild(content.cloneNode(true))
            content = doc
        }

        var exprs = []
        var elements = [{ el: content, path: [] }]
        while (elements.length > 0) {
            var { el, path } = elements.shift()

            exprs = exprs.concat(this._compileEl(el, path))

            // enqueue children
            el.childNodes.forEach(function(el, i) {
                elements.push({ el, path: path.concat(['childNodes', i]) })
            })
        }

        // we opt to compile the repeat/cond expressions separately than the
        // rest of this template - because (a) the template might relay on a
        // repeated ${item} property that doesn't yet exist in the repeat
        // expression, and (b) it's must smaller/faster than the complete
        // expressions list.
        // NB: It might not be that beneficial for cond though.
        exprs = Object.assign(exprs, { eval: compileExpressions(exprs) })
        return { content, exprs }
    }

    _compileEl(el, path) {
        var exprs = []

        // inner content expressions
        if (el.nodeName === '#text') {
            var expr = isExpressions(el.textContent)
            if (expr) {
                el.textContent = ''
                var render = (el, v) => (el.textContent = v || '')
                exprs.push({ expr, path, render })
            }
        }

        // attributes
        for (var attr of el.attributes || []) {
            var expr = isExpressions(attr.value)
            if (expr === null) {
                continue
            }

            // hide expresssions from the imported templates
            attr = attr.name
            el.removeAttribute(attr)

            var render
            if (attr.startsWith('on-')) {
                render = this._renderEvent(attr.slice(3)) // trim 'on-'
            } else if (attr === 'class') {
                render = this._renderClass()
            } else if (attr === 'style') {
                render = this._renderStyle()
            } else if (attr === 'repeat') {
                render = this._renderRepeat(el, 'repeat')
            } else if (attr === 'if') {
                render = this._renderIf(el)
            } else {
                render = this._renderProp(snakeToCamelCase(attr))
            }

            exprs.push({ expr, path, attr, render })

            if (render.__stopCompilation) {
                // some directives (for) may require to stop the compilation as
                // they handle the rest of it internally
                break
            }
        }

        return exprs
    }

    _renderProp(prop) {
        return (el, v) => el[prop] = v
    }

    _renderClass() {
        return function(el, v) {
            if (typeof v === 'object') {
                if (!Array.isArray(v)) {
                    v = Object.keys(v).filter((k) => v[k])
                }

                return v.join(' ')
            }

            el.className = v
        }
    }

    _renderStyle() {
        return (el, v) => typeof v === 'object'
            ? Object.assign(el.style, v)
            : el.setAttribute('style', v)
    }

    _renderEvent(evName) {
        return function(el, v) {
            var evs = el.__plutoEvs || (el.__plutoEvs = {})
            if (evs[evName] !== v) {
                el.removeEventListener(evName, evs[evName])
                el.addEventListener(evName, evs[evName] = v)
            }
        }
    }

    _renderIf(el) {
        var renderFn = this._renderItems(el)
        return function(el, items, obj) {
            return renderFn(el, items ? [obj.item] : [], obj)
        }
    }

    _renderRepeat(el, k) {
        var { content, exprs } = this.compile(el.content || el);
        el.replaceWith(new RepeatedNode())
        el.innerHTML = ''
        return function(el, v, obj) {
            var isInited = el instanceof RepeatedNode
            if (!isInited) {
                Object.setPrototypeOf(el, RepeatedNode.prototype)
                el.content = content
                el.exprs = exprs
            }

            el.obj = obj
            el[k] = v
        }

        var renderFn = this._renderItems(el)
        return Object.assign(function(el, items, obj) {
            if (items && items.length !== undefined) {
                return renderFn(el, items, obj)
            }

            if (typeof items === 'object') {
                items = Object.keys(items).map(function(k) {
                    return { key: k, value: items[k] }
                })
            }

            if (typeof items === 'boolean') {
                items = Number(items) // 0 or 1
            }

            if (typeof items === 'number') {
                items = new Array(items) // range-items, repeat N times.
                items = Array.from(items).map(() => obj.item)
            }

            return renderFn(el, items, obj)
        }, { __stopCompilation: true })
    }

    _renderItems(el) {
        el.replaceWith(document.createTextNode(''))
        var { content, exprs } = this.compile(el.content || el)
        return function(el, items, obj) {
            el.__items || (el.__items = [])

            // remove obsolete items
            while (el.__items.length > items.length) {
                el.__items.pop().remove()
            }

            // update existing items
            for (var i = 0; i < el.__items.length; i += 1) {
                obj.item = items[i]
                el.__items[i].render(obj)
            }

            // create new items
            while (el.__items.length < items.length) {
                var i = el.__items.length
                obj.item = items[i]
                var doc = new Renderer(content, exprs).render(this.obj)
                this.__items.push(doc)
                this.before(doc)
            }
        }
    }
}

class RepeatedNode extends Text {

    set repeat(items) {
        this.__items || (this.__items = [])

        // remove obsolete items
        while (this.__items.length > items.length) {
            this.__items.pop().remove()
        }

        // update existing items
        for (var i = 0; i < this.__items.length; i += 1) {
            this.obj.item = items[i]
            this.__items[i].render(this.obj)
        }

        // create new items
        while (this.__items.length < items.length) {
            var i = this.__items.length
            this.obj.item = items[i]
            var doc = new Renderer(this.content, this.exprs).render(this.obj)
            this.__items.push(doc)
            this.before(doc)
        }
    }
}

class Renderer extends DocumentFragment {
    constructor(content, exprs, items) {
        super()
        this.exprs = exprs
        this.appendChild(document.importNode(content, true))

        // copy the list of generated elements from the template in order
        // to support removals
        this.elements = [].map.call(this.childNodes, child => child)
        this.paths = this.exprs.map((expr) => select(this, expr.path))
    }

    remove() {
        while (this.elements.length > 0) {
            this.elements.pop().remove()
        }
    }

    render(obj) {
        var else_ = obj.__plutoElse
        obj.__plutoElse = false

        var values = this.exprs.eval(obj)
        for (var i = 0 ; i < this.exprs.length ; i += 1) {
            var expr = this.exprs[i]
            var el = this.paths[i]
            var v = values[i]
            expr.render(el, v, obj)
        }

        var ev = new Event('pluto-rendered', { bubles: false })
        for (var el of this.paths) {
            el.dispatchEvent(ev)
        }

        obj.__plutoElse = else_
        return this
    }
}

// -- HELPER FUNCTIONS

// Searches for an element from root based on the property-path to the child
// example: root = <body>, path = childNodes.3.childNode.7. Resolved by walking
// the path down to the child.
function select(root, path) {
    var el = root
    for (var i = 0; el !== undefined && i < path.length; i += 1) {
        el = el[path[i]]
    }
    return el
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
    code = exprs.map(function(expr, i) {
        if (expr.expr === undefined) {
            return '' // can happen in nested templates
        }

        if (expr.expr) {
            refs = refs.concat(getIdentifiers(expr.expr))
        }

        return `arguments[0][${i}] = T\`${expr.expr}\``
    }).join(';\n')

    // define the local variables and bind root-level functions to the provided
    // rendered object.
    var keys = refs.reduce((keys, k) => (keys[k] = true, keys), {})
    var locals = Object.keys(keys).map(function (k) {
        return `
            var ${k} = this["${k}"];
            typeof ${k} === 'function' && (${k} = bindFn(this, ${k}))
        `
    }).join(';\n')

    var fn = eval('(function () {\n' + locals + '\n' + code + '\n})')
    return function(obj) {
        var res = []
        try {
            fn.call(obj, res)
        } catch (e) {
            console.warn(fn)
            throw e
        }

        return res
    }

    function bindFn(obj, fn) {
        var bound = fn.__plutoBound || (fn.__plutoBound = {})
        if (bound.to !== obj) {
            bound.to = obj
            bound.fn = fn.bind(obj)
        }

        return bound.fn
    }

    function T(s, v) {
        return arguments.length > 2 || typeof v === 'string'
            ? String.raw.apply(null, arguments)
            : v
    }
}

// generate the list of identifiers found in the code.
function getIdentifiers(expr) {
    var re = /[$A-Z_][0-9A-Z_$]*/ig
    var whitespace = ' \n\r\t'
    var disallowed = '\'\".'
    var skip = ['true', 'false', 'if', 'for', 'while', 'do', 'try', 'catch',
        'break', 'continue', 'switch', 'throw', 'this', 'instanceof', 'in',
        'function', 'delete', 'default', 'case', 'debugger', 'const', 'var',
        'with', 'typeof', 'super', 'class', 'new', 'null', 'return', 'let',
        'import', 'else', 'enum', 'extends', 'finally', '$']

    // We first match for the valid identifier, and then check the previous
    // non-whitespace character preceeding the identifier to verify that it's
    // not a string or nested element.
    var refs = {}
    var match
    while (match = re.exec(expr)) {
        if (skip.indexOf(match[0]) !== -1) {
            continue // skipped or reserved keyword
        }

        if (window[match[0]] !== undefined) {
            continue // keep global functions (Object, Array, etc.)
        }

        var lastChar = undefined
        do {
            match.index -= 1
            if (whitespace.indexOf(expr[match.index]) === -1) {
                lastChar = expr[match.index]
            }
        } while (match.index > -1 && !lastChar)

        if (disallowed.indexOf(lastChar) === -1) {
            refs[match[0]] = true
        }
    }

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
pluto.RepeatRenderer = Renderer
window.pluto = pluto
})();

(function() {

    // placed here in order to have its own scope clear of any of the pluto
    // local variables.
    pluto._eval = function(code) {
        return eval(code)
    }
})();
