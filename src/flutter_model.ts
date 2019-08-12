
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
    placeHolder: 'Fields names, eg: name:z,age:i,phone:z,email:z,active:b'
  }) || "";

  if (fieldsStr === ""){
    return;
  }

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

  var modelFilePath = `${modelDir}/${nameSnake}.dart`;

  if (fs.existsSync(modelFilePath)) {
    window.showWarningMessage(`File already exists: ${modelFilePath}`);
  } else {
    fs.writeFileSync(modelFilePath, genCode(name, flutter, opts));
    openAndFormatFile(modelFilePath);
  }
}

export function genCode(name: String, flutter: FlutterInfo, opts: GenModelOpts) {
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
  var newFields = [];

  for (let _field of opts.fields) {
    var newFieldName = _field.trim();
    var tyIsPlural = false;
    var ty = "String";

    let s = _field.split(':');

    if (s.length === 1) {
      s.push('z');
    }
    newFieldName = s[0];

    switch (s[1]) {
      case 'id': {
        ty = "int";
        break;
      }
      case 'z': {
        ty = "String";
        break;
      }
      case 'b': {
        ty = "bool";
        break;
      }
      case 'dt': {
        ty = "String";
        break;
      }
      case 'i':
      case 'i32': {
        ty = "int";
        break;
      }
      case 'i64': {
        ty = "int";
        break;
      }
      case 'd': {
        ty = "double";
        break;
      }
      case 'z[]': {
        tyIsPlural = true;
        ty = "List<String>";
        break;
      }
      case 'i[]':
      case 'i32[]': {
        tyIsPlural = true;
        ty = "List<int>";
        break;
      }
      case 'i[]':
      case 'i64[]': {
        tyIsPlural = true;
        ty = "List<int>";
        break;
      }
      case 'b[]': {
        tyIsPlural = true;
        ty = "List<bool>";
        break;
      }
    }

    console.log("paramName: " + newFieldName);

    const newFieldNameSnake = snakeCase(newFieldName);
    const newFieldNameCamel = camelCase(newFieldName);

    params.push(`this.${newFieldNameCamel}`);
    supers.push(newFieldNameCamel);

    fields.push(`  final ${ty} ${newFieldNameCamel};`);
    toMaps.push(`    data["${newFieldNameSnake}"] = this.${newFieldNameCamel};`);
    if (tyIsPlural){
      fromMaps.push(`List.from(data['${newFieldNameSnake}'])`);
    }else{
      fromMaps.push(`data['${newFieldNameSnake}'] as ${ty}`);
    }
    copiesParams.push(`${ty} ${newFieldNameCamel}`);
    copiesAssigns.push(`${newFieldNameCamel} ?? this.${newFieldNameCamel}`);
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
