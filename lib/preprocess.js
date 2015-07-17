/*
 * preprocess
 * https://github.com/onehealth/preprocess
 *
 * Copyright (c) 2012 OneHealth Solutions, Inc.
 * Written by Jarrod Overson - http://jarrodoverson.com/
 * Licensed under the Apache 2.0 license.
 */

/*jshint node:true*/

'use strict';

exports.preprocess         = preprocess;
exports.preprocessFile     = preprocessFile;
exports.preprocessFileSync = preprocessFileSync;

var path  = require('path'),
    fs    = require('fs'),
    delim = require('./regexrules');

function preprocessFile(src, dest, context, callback) {
  context.src = src;
  context.srcDir = path.dirname(src);

  fs.readFile(src,function(err,data){
    if (err) return callback(err,data);
    var parsed = preprocess(data, context, getExtension(src));
    fs.writeFile(dest,parsed,callback);
  });
}

function preprocessFileSync(src, dest, context, options) {
  context.src = src;
  context.srcDir = path.dirname(src);

  var data = fs.readFileSync(src);
  var parsed = preprocess(data, context, getExtension(src), options);
  return fs.writeFileSync(dest,parsed);
}


function getExtension(filename) {
  var ext = path.extname(filename||'').split('.');
  return ext[ext.length - 1];
}

function preprocess(src,context,type,options) {
  src = src.toString();
  context = context || process.env;
  context = getFlattedContext(context);

  if (typeof delim[type] === 'undefined'){
    type = 'html';
  }

  var rv = src;
  
  if (!options || !options.ignoreInclude) { 
      rv = rv.replace(getRegex(type,'include'),function(match,line,file,include){
        file = (file || '').trim();
        var indent = line.replace(/\S/g, ' ');
        var includedContext = JSON.parse(JSON.stringify(context));
        includedContext.src = path.join(context.srcDir,file);
        includedContext.srcDir = path.dirname(includedContext.src);
        if (!fs.existsSync(includedContext.src)) {
          return includedContext.src + ' not found';
        }
        var includedSource = fs.readFileSync(includedContext.src);
        includedSource = preprocess(includedSource, includedContext, type);
        includedSource = includedSource.replace(/\r?\n/g, '\n' + indent);
        if(includedSource) {
            return line + includedSource;
        } else {
            return "";
        }
      });
  }

  if (delim[type].exclude) {
    rv = rv.replace(getRegex(type,'exclude'),function(match,test,include){
      return testPasses(test,context) ? '' : include;
    });
  }

  if (delim[type].ifdef) {
    rv = rv.replace(getRegex(type,'ifdef'),function(match,test,include){
      test = (test || '').trim();
      return typeof context[test] !== 'undefined' ? include : '';
    });
  }

  if (delim[type].useElement && context.MODULE_ELEMENTS_BASE) {
    var extensionToAddToInclusionFiles = '.' + type;
    rv = rv.replace(getRegex(type,'useElement'),function(match,line,file,include){        
        var strExtraContext = "";
        var extraContextStart = match.indexOf('data-context');
        if (extraContextStart>=0) {
            var strExtraContext = match.substring(extraContextStart+('data-context').length+1);
            var colonSign = strExtraContext[0];
            strExtraContext = strExtraContext.substring(1); //removing the beginning ' or "
            var extraContextEnd = strExtraContext.indexOf(colonSign); //finding the trailing ' or "
            strExtraContext = strExtraContext.substring(0,extraContextEnd);
        }
        
        var jsonExtraContext = {};
        if (strExtraContext!=="" && strExtraContext[0]=='{') {
            //is json!, parse it
            strExtraContext = strExtraContext.replace(/\'/g,'"');
            jsonExtraContext = JSON.parse(strExtraContext);
        }
        
        
        
        var elementsFilePath = context.MODULE_ELEMENTS_BASE + '/' + file + extensionToAddToInclusionFiles;
        
        
        var includedContext = JSON.parse(JSON.stringify(context));
        includedContext.src = elementsFilePath;
        includedContext.srcDir = path.dirname(includedContext.src);
        
        if (jsonExtraContext.context) {
            //this will be used in the preprocess contex too! :)
            for (var attrname in jsonExtraContext.context) { includedContext[attrname] = jsonExtraContext.context[attrname]; }
        }
        
        
        
        var indent = line.replace(/\S/g, ' ');
        
        if (!fs.existsSync(includedContext.src)) {
          return includedContext.src + ' not found';
        }
        
        var includedSource = fs.readFileSync(includedContext.src);
        includedSource = preprocess(includedSource, includedContext, type);
        includedSource = includedSource.replace(/\r?\n/g, '\n' + indent);
        if(includedSource) {
            //We want the includedSource to be able to identify itself by additional processed content
            if (options && typeof options.inclusionProcessor == 'function') {
                includedSource = options.inclusionProcessor(includedSource, elementsFilePath, process.cwd());
            }
            
            includedSource = line + includedSource;
            
            for (var strKey in jsonExtraContext) {
                var val = jsonExtraContext[strKey];
                
                includedSource = includedSource.replace(new RegExp('{{'+strKey+'}}', 'gi'), val);
            }
            return includedSource;
        } else {
            return "";
        }
      });
  }

  if (delim[type].ifndef) {
    rv = rv.replace(getRegex(type,'ifndef'),function(match,test,include){
      test = (test || '').trim();
      return typeof context[test] === 'undefined' ? include : '';
    });
  }

  if (delim[type].if) {
    rv = rv.replace(getRegex(type,'if'),function(match,test,include){
      return testPasses(test,context) ? include : '';
    });
  }

  rv = rv.replace(getRegex(type,'echo'),function(match,variable) {
    variable = (variable || '').trim();
    // if we are surrounded by quotes, echo as a string
    var stringMatch = variable.match(/^(['"])(.*)\1$/);
    if (stringMatch) return stringMatch[2];

    return context[(variable || '').trim()];
  });

  rv = rv.replace(getRegex(type,'exec'),function(match,variable,name,value) {
    name = (name || '').trim();
    value = value || '';

    var params = value.split(',');
    var stringRegex = /^['"](.*)['"]$/;
    for (var k in params) {
      if (params.hasOwnProperty(k)) {
        var key = params[k].trim();
        if (key.search(stringRegex) !== -1) { // handle string parameter
          params[k] = key.replace(stringRegex, '$1');
        } else if (typeof context[key] !== 'undefined') { // handle variable parameter
          params[k] = context[key];
        }
      }
    }

    // if we are surrounded by quotes, echo as a string
    var stringMatch = variable.match(/^(['"])(.*)\1$/);
    if (stringMatch) return stringMatch[2];

    if (!context[name] || typeof context[name] !== 'function') return '';

    return  context[name].call(this, params);
  });

  return rv;
}

function getRegex(type, def) {

  var isRegex = typeof delim[type][def] === 'string' || delim[type][def] instanceof RegExp;
  return isRegex ?
            new RegExp(delim[type][def],'gmi') :
            new RegExp(delim[type][def].start + '((?:.|\n|\r)*?)' + delim[type][def].end,'gmi');
}

// @todo: fix this lodash template hackiness. Got this working quickly but is dumb now.
function getTestTemplate(test) {
  /*jshint evil:true*/
  test = test || 'true==true';

  // force single equals replacement
  test = test.replace(/([^=])=([^=])/g, '$1==$2');

  return new Function("context", "with (context||{}){ return ( " + test + " ) }");
}

function testPasses(test,context) {
  var testFn = getTestTemplate(test);
  return testFn(context);
}

function getFlattedContext(context) {
  var toReturn = {};
  for (var i in context) {
    if (!context.hasOwnProperty(i)) continue;

    toReturn[i] = context[i];
    if ((typeof context[i]) === 'object') {
      var flatObject = getFlattedContext(context[i]);
      for (var x in flatObject) {
        if (!flatObject.hasOwnProperty(x)) continue;

        toReturn[i + '.' + x] = flatObject[x];
      }
    }
  }
  return toReturn;
}
