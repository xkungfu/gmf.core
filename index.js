/**
 * 框架核心
 * @authors yutent (yutent@doui.cc)
 * @date    2015-11-25 18:06:14
 *
 */

import 'es.shim' // 加载拓展方法
import init from './lib/reg-init'

import http from 'http'
import path from 'path'
import Request from 'http.request'
import Response from 'http.response'

import Smarty from 'smartyx' //模板引擎
import Log from './lib/module/log' //基础日志记录工具
import Email from './lib/module/sendmail' //加载email发送类
import Mysql from 'mysqli' //加载mysql操作类
import Ioredis from 'ioredis'

import sec from 'crypto.js'
import path from 'path'
import url from 'url'
import fs from 'iofs'
import child from 'child_process'

import Controller from './lib/controller'

import routerWare from './lib/middleware/router'
import cookieWare from './lib/middleware/cookie'
import sessionWare from './lib/middleware/session'
import credentialsWare from './lib/middleware/credentials'

var log = console.log

function hideProperty(host, name, value) {
  Object.defineProperty(host, name, {
    value: value,
    writable: true,
    enumerable: false,
    configurable: true
  })
}

export default class Five {
  constructor() {
    hideProperty(this, '__FIVE__', Object.assign({}, init))
    hideProperty(this, '__MODULES__', { __error__: null })
    hideProperty(this, '__MIDDLEWARE__', [])
    hideProperty(this, '__INSTANCE__', {})

    global.libs = {
      Smarty, //模板引擎
      Log, //基础日志记录工具
      Email, //加载email发送类
      Mysql, //加载mysql操作类
      Ioredis
    }
    global.Util = {
      sec,
      path,
      url,
      fs,
      child
    }
    global.Controller = Controller
  }

  __init__() {
    var { domain, website, session } = this.__FIVE__
    domain = domain || website
    session.domain = session.domain || domain
    this.set({ domain, session })

    // 这里只创建session的存储器, 而初始化操作在中间件中进行
    if (session.type === 'redis') {
      hideProperty(
        this,
        '__SESSION_STORE__',
        new libs.Ioredis({
          host: session.db.host || '127.0.0.1',
          port: session.db.port || 6379,
          db: session.db.db || 0
        })
      )
    } else {
      hideProperty(this, '__SESSION_STORE__', {})
    }

    // 将session和cookie的中间件提到最前
    // 以便用户自定义的中间件可以直接操作session和cookie
    this.__MIDDLEWARE__.unshift(sessionWare)
    this.__MIDDLEWARE__.unshift(cookieWare)
    this.__MIDDLEWARE__.unshift(credentialsWare)

    this.use(routerWare)
  }

  /*------------------------------------------------------------------------*/

  // 注册属性到全局Five对象
  set(obj) {
    for (let i in obj) {
      if (typeof obj[i] === 'object' && !Array.isArray(obj[i])) {
        if (!this.__FIVE__[i]) {
          this.__FIVE__[i] = obj[i]
        } else {
          try {
            Object.assign(this.__FIVE__[i], obj[i])
          } catch (err) {
            log(err)
          }
        }
      } else {
        this.__FIVE__[i] = obj[i]
      }
    }
    return this
  }

  // 获取全局配置
  get(key) {
    try {
      return new Function('o', `return o.${key}`)(this.__FIVE__)
    } catch (err) {
      return
    }
  }

  // 加载中间件/缓存模块
  // 与别的中间件用法有些不一样, 回调的传入参数中的req和res,
  // 并非原生的request对象和response对象,
  // 而是框架内部封装过的,可通过origin属性访问原生的对象
  use(key, fn) {
    if (arguments.length === 1) {
      if (typeof key !== 'function') {
        throw TypeError('argument 1 must be a callback')
      }
      this.__MIDDLEWARE__.push(key)
    } else {
      if (typeof key !== 'string') {
        return
      }
      libs[key] = fn
    }
  }
  // 预加载应用
  preload(dir) {
    var list = Util.fs.ls(dir)

    if (list) {
      list.forEach(file => {
        var { name } = path.parse(file)
        if (name.startsWith('.')) {
          return
        }
        try {
          this.__MODULES__[name] = import(file)
        } catch (err) {
          this.__MODULES__.__error__ = err
        }
      })
    }

    return this
  }

  // 注册实例化对象到实例池中
  // 与use方法不同的是, 这个会在server创建之前就已经执行
  ins(name, fn) {
    var _this = this
    if (arguments.length === 1) {
      return this.__INSTANCE__[name]
    }
    if (typeof fn === 'function') {
      fn.call(this, this.__FIVE__, function next(instance) {
        if (instance) {
          _this.__INSTANCE__[name] = instance
        }
      })
    }
  }

  // 启动http服务
  listen(port) {
    var _this = this

    this.__init__()

    var server = http.createServer(function(req, res) {
      var response = new Response(req, res)
      var request = new Request(req, res)

      response.set('X-Powered-By', 'Five.js')

      var middleware = _this.__MIDDLEWARE__.concat()
      var fn = middleware.shift()
      if (fn) {
        ;(async function next() {
          await fn.call(_this, request, response, function() {
            fn = middleware.shift()
            if (fn) {
              next()
            }
          })
        })()
      }
    })

    server.listen(port || this.get('port'))

    return server
  }
}
