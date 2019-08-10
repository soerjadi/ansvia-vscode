
import { window, workspace, ExtensionContext, commands, Uri, WorkspaceEdit, TextEdit } from 'vscode';
import { getRootDir, ProjectType, getFlutterInfo, FlutterInfo } from './util';
import { doGenerateBlocCode, BlocOpts } from './bloc';
import { Cmd } from './cmd';
import { openAndFormatFile } from './flutter_util';

var snakeCase = require('snake-case');
var camelCase = require('camel-case');
var pascalCase = require('pascal-case');

var fs = require('fs');

export class GenModelOpts {
  fields: string[];

  constructor() {
    this.fields = [];
  }
}

export async function generateModel(opts: GenModelOpts) {
  const flutter = getFlutterInfo();

  if (!flutter) {
    return;
  }

  // get component name
  const name = await window.showInputBox({
    value: '',
    placeHolder: 'Model name, eg: Todo'
  }) || "";

  const fieldsStr = await window.showInputBox({
    value: '',
    placeHolder: 'Fields names, eg: namez,agei,phonez,emailz,activeb'
  }) || "";

  var fields: string[] = fieldsStr.split(',');
  opts.fields = fields;

  var libDir = `${flutter.projectDir}/lib`;
  var modelDir = `${libDir}/models`;

  if (!fs.existsSync(libDir)) {
    fs.mkdirSync(libDir);
    if (!fs.existsSync(modelDir)) {
      fs.mkdirSync(modelDir);
    }
  }
  var nameSnake = snakeCase(name);

  // var modelNameDir = nameSnake;

  // if (!fs.existsSync(`${modelDir}/${modelNameDir}`)) {
  //   fs.mkdirSync(`${modelDir}/${modelNameDir}`);
  // }

  // var modelFilePath = `${modelDir}/${modelNameDir}/${nameSnake}.dart`;

  var modelFilePath = `${modelDir}/${nameSnake}.dart`;

  if (fs.existsSync(modelFilePath)) {
    window.showWarningMessage(`File already exists: ${modelFilePath}`);
  } else {
    fs.writeFileSync(modelFilePath, _genCode(name, flutter, opts));
    openAndFormatFile(modelFilePath);
  }
}

function _genCode(name: String, flutter: FlutterInfo, opts: GenModelOpts) {
  const projectNameSnake = snakeCase(flutter.projectName);
  const nameSnake = snakeCase(name);
  const namePascal = pascalCase(name);

  var fields = [];
  var params = [];
  var supers = [];
  var fromMaps = [];
  var toMaps = [];
  var copiesParams = [];
  var copiesAssigns = [];
  for (let _field of opts.fields) {
    const paramName = _field.trim().slice(0, -1);
    const paramNameSnake = snakeCase(paramName);
    params.push(`this.${paramName}`);
    supers.push(paramName);

    var ty = "String";
    if (_field.endsWith('i')) {
      ty = "int";
    } else if (_field.endsWith('z')) {
      ty = "String";
    } else if (_field.endsWith('b')) {
      ty = "bool";
    }
    fields.push(`  final ${ty} ${paramName};`);
    toMaps.push(`    data["${paramNameSnake}"] = this.${paramName};`);
    fromMaps.push(`data['${paramNameSnake}'] as ${ty}`);
    copiesParams.push(`${ty} ${paramName}`);
    copiesAssigns.push(`${paramName} ?? this.${paramName}`);
  }
  var paramsAdd = "";
  if (params.length > 0) {
    paramsAdd = `, ${params.join(',')}`;
  }
  var supersAdd = "";
  if (supers.length > 0) {
    supersAdd = ", " + supers.join(',');
  }
  var fromMapsAdd = "";
  if (fromMaps.length > 0) {
    fromMapsAdd = ", " + fromMaps.join(',');
  }
  var copiesAssignsAdd = "";
  if (copiesAssigns.length > 0) {
    copiesAssignsAdd = ", " + copiesAssigns.join(", ");
  }

  return `
import 'package:equatable/equatable.dart';
import 'package:meta/meta.dart';

@immutable
class ${namePascal} extends Equatable {
  final int id;
  ${fields.join('\n').trim()}

  ${namePascal}(this.id${paramsAdd})
      : super([id${supersAdd}]);

  Map<String, dynamic> toMap() {
    Map<String, dynamic> data = Map();
    data["id"] = this.id;
    ${toMaps.join('\n').trim()}
    return data;
  }

  static ${namePascal} fromMap(Map<String, dynamic> data) {
    return ${namePascal}(
        data['id'] as int${fromMapsAdd});
  }

  ${namePascal} copy({${copiesParams.join(', ')}}) {
    return ${namePascal}(this.id${copiesAssignsAdd});
  }
}`;
}
