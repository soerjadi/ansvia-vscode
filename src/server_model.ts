import { getRootDir, ProjectType, openFile, normalizeName, nameToPlural, insertLineInFile } from "./util";
import { window, Position } from "vscode";;

const snakeCase = require('snake-case');
const pascalCase = require('pascal-case');
const fs = require('fs');

export enum ServerKind {
  Model,
  DaoInline,
  DaoNewFile,
  ModelToApiType
}

export class ServerOpts {
  kind: ServerKind;
  constructor(kind: ServerKind) {
    this.kind = kind;
  }
}

export async function generateModel(opts: ServerOpts) {
  const rootDir = getRootDir(ProjectType.Server);

  if (!rootDir) {
    return;
  }

  // console.log("rootDir: " + rootDir);

  var name = "";

  if (opts.kind !== ServerKind.ModelToApiType) {
    name = await window.showInputBox({
      value: '',
      placeHolder: 'Service name, example: Account'
    }) || "";

    if (name.length === 0) {
      window.showInformationMessage("No name");
      return;
    }
  }

  const editor = window.activeTextEditor!;

  switch (opts.kind) {
    case ServerKind.Model: {
      const fieldsStr = await window.showInputBox({
        value: '',
        placeHolder: 'Fields, eg: id:id,name:z,active:b,timestamp:dt,num:i,num:i64,keywords:z[]'
      }) || "";
      let fields = fieldsStr.split(',').map((a) => a.trim());
      editor.edit(builder => {
        let result = generateModelCode(name, fields);
        builder.replace(editor.selection.anchor, result);
      });
      break;
    }
    case ServerKind.DaoInline:
    case ServerKind.DaoNewFile: {
      const fieldsStr = await window.showInputBox({
        value: '',
        placeHolder: 'Fields, eg: name:z,active:b,timestamp:dt,num:i,num:i64,keywords:z[]'
      }) || "";
      let fields = fieldsStr.split(',').map((a) => a.trim()).filter((a) => a.length > 0);
      
      if (opts.kind === ServerKind.DaoInline){
        editor.edit(builder => {
          let result = generateDaoCode(name, fields, opts);
          builder.replace(editor.selection.anchor, result);
        });
      }else if (opts.kind === ServerKind.DaoNewFile){
        editor.edit(() => {
          let nameSnake = snakeCase(name);
          let result = generateDaoCode(name, fields, opts);
          let daoFile = `${rootDir}/src/${nameSnake}_dao.rs`;
          fs.writeFileSync(daoFile, result);

          // update lib.rs files
          // add pub mod into mod.rs file
          insertLineInFile(`${rootDir}/src/lib.rs`, "pub mod", `pub mod ${nameSnake}_dao;`);
          insertLineInFile(`${rootDir}/src/dao.rs`, "pub use", `pub use crate::${nameSnake}_dao::${pascalCase(name)}Dao;`);
          openFile(daoFile);
        });
      }
      break;
    }
    case ServerKind.ModelToApiType: {
      editor.edit(builder => {
        let result = generateModelToApiConverter();
        let nextPos = editor.selection.end.line + 1;
        builder.replace(new Position(nextPos, 0), '\n' + result + '\n');
      });
      break;
    }
  }
}


export async function generateModelFromSQLDef(_: ServerOpts) {

  const reTableName = new RegExp('CREATE TABLE ([\\w_]+?) \\(');
  const reField = new RegExp('^\"?([\\w_]*?)\"? *?(BIGSERIAL|BIGINT|INT|INTEGER|DECIMAL|SMALLINT|SERIAL|VARCHAR|TEXT|FLOAT|DOUBLE|BOOLEAN|TIMESTAMP)(\\[\\])?');

  const editor = window.activeTextEditor!;

  const text = editor.document.getText(editor.selection);

  var name = "";

  let lines = text.split('\n');
  let fields = [];

  for (let line of lines) {
    var s;
    var linet = line.trim();

    if (name === "") {
      s = reTableName.exec(linet);
      if (s === null) {
        continue;
      }

      if (s[1]) {
        name = s[1].trim();
        if (name.endsWith('ies')) { // plural
          name = name.substring(0, name.length - 3) + 'y';
        } else if (name.endsWith('s')) { // plural
          name = name.substring(0, name.length - 1);
        }
      }
    }

    s = reField.exec(linet);

    // print(s);

    if (s === null) {
      continue;
    }

    const field = s[1].trim();
    const sqlTy = s[2].toLowerCase();
    const isPlural = s[3] ? true : false;


    switch (sqlTy) {
      case "bigserial":
      case "bigint":
      case "int":
      case "smallint":
      case "integer":
      case "numeric":
      case "decimal":
      case "serial": {
        if (isPlural) {
          fields.push(`${field}:i[]`);
        } else {
          if (field === 'id' || field.endsWith('_id')){
            fields.push(`${field}:id`);
          }else{
            fields.push(`${field}:i`);
          }
        }
        break;
      }
      case "float":
      case "double": {
        if (isPlural) {
          fields.push(`${field}:d[]`);
        } else {
          fields.push(`${field}:d`);
        }
        break;
      }
      case "varchar":
      case "text": {
        if (isPlural) {
          fields.push(`${field}:z[]`);
        } else {
          fields.push(`${field}:z`);
        }
        break;
      }
      case "boolean": {
        if (isPlural) {
          fields.push(`${field}:b[]`);
        } else {
          fields.push(`${field}:b`);
        }
        break;
      }
      case "timestamp": {
        fields.push(`${field}:dt`);
      }
    }
  }

  if (name === "") {
    window.showWarningMessage("Cannot get model name");
  }

  const rootDir = getRootDir(ProjectType.Server);

  if (!rootDir) {
    return;
  }



  const generatedCode = generateModelCode(name, fields);

  var modelFilePath = `${rootDir}/src/models.rs`;

  fs.appendFileSync(modelFilePath, generatedCode + '\n');
  openFile(modelFilePath);
}


function generateModelToApiConverter(): string {
  const editor = window.activeTextEditor!;

  const text = editor.document.getText(editor.selection);
  // console.log("selected text: " + text);

  const reName = new RegExp("pub struct (\\w*) {");
  const reField = new RegExp("pub (\\w*): *([a-zA-Z0-9_<>:]*),?");

  var name = "";

  let lines = text.split('\n');
  let newLines = [];
  // let fields = [];

  for (let line of lines) {
    var s = reName.exec(line);
    if (s && s[1]) {
      if (name !== "") {
        window.showWarningMessage("Name already defined: " + name);
        return "";
      }
      name = s[1].trim();
      const namePascal = pascalCase(name);
      newLines.push(`impl ToApiType<${namePascal}> for models::${namePascal} {`);
      newLines.push(`    fn to_api_type(&self, conn: &PgConnection) -> ${namePascal} {`);
      newLines.push(`        ${namePascal} {`);
      continue;
    }
    if (name.length > 0) {
      s = reField.exec(line);
      if (s === null) {
        continue;
      }
      // console.log("s: " + s);
      // console.log("s[2]: " + s[2]);
      if (s[1]) {
        if (s[2].trim() === "String") {
          newLines.push(`            ${s[1]}: self.${s[1]}.to_owned(),`);
        } else if (s[2].startsWith("Vec")) {
          newLines.push(`            ${s[1]}: self.${s[1]}.clone(),`);
        } else {
          newLines.push(`            ${s[1]}: self.${s[1]},`);
        }
      }
    }
  }
  newLines.push('        }');
  newLines.push('    }');
  newLines.push('}');

  return newLines.join('\n');
}

function generateDaoCode(name: string, fields: string[], opts: ServerOpts) {
  name = normalizeName(name);
  const namePascal = pascalCase(name);
  const nameSnake = snakeCase(name);

  var newFields = [];

  for (let _field of fields) {
    var newFieldName = _field.trim();
    var ty = "&'a str";

    let s = _field.split(':');

    if (s.length === 1) {
      s.push('z');
    }
    newFieldName = s[0];

    switch (s[1]) {
      case 'id': {
        ty = "ID";
        break;
      }
      case 'z': {
        ty = "&'a str";
        break;
      }
      case 'b': {
        ty = "bool";
        break;
      }
      case 'dt': {
        ty = "NaiveDateTime";
        break;
      }
      case 'i':
      case 'i32': {
        ty = "i32";
        break;
      }
      case 'i64': {
        ty = "i64";
        break;
      }
      case 'd': {
        ty = "f64";
        break;
      }
      case 'z[]': {
        ty = "&'a Vec<String>";
        break;
      }
      case 'i[]':
      case 'i32[]': {
        ty = "Vec<i32>";
        break;
      }
      case 'i[]':
      case 'i64[]': {
        ty = "Vec<i64>";
        break;
      }
    }

    // console.log("newFieldName: " + newFieldName);

    const newFieldNameSnake = snakeCase(newFieldName);

    newFields.push([newFieldNameSnake, ty]);
  }

  let tableName = nameToPlural(nameSnake);

  var newLines = [];


  if (opts.kind === ServerKind.DaoNewFile){
    newLines.push(`//! Dao implementation for ${name}
//! 

use chrono::prelude::*;
use diesel::prelude::*;

use crate::{ID, result::Result, models::${namePascal}, schema::${tableName}};
`);
  }

  newLines.push(`
#[derive(Insertable)]
#[table_name = "${tableName}"]
struct New${namePascal}<'a> {`);

  for (let fld of newFields) {
    newLines.push(`    pub ${fld[0]}: ${fld[1]},`);
  }

  newLines.push('}\n');

  newLines.push(`
/// Data Access Object for ${name}
#[derive(Dao)]
#[table_name="${tableName}"]
pub struct ${namePascal}Dao<'a> {
    db: &'a PgConnection,
}
`);

  newLines.push(`
impl<'a> ${namePascal}Dao<'a> {
  /// Create new ${namePascal}
  pub fn create(&self,
`.trim());

  for (let fld of newFields) {
    newLines.push(`      ${fld[0]}: ${fld[1]},`);
  }
  newLines.push(`    ) -> Result<${namePascal}> {`);
  newLines.push(`    use crate::schema::${tableName}::{self, dsl};`);

  newLines.push(`
    diesel::insert_into(${tableName}::table)
        .values(&New${namePascal} {`);

  for (let fld of newFields) {
    newLines.push(`            ${fld[0]},`);
  }

  newLines.push(`        })
        .get_result(self.db)
        .map_err(From::from)
  }
}`);

  return newLines.join('\n');
}

function generateModelCode(name: String, fields: String[]) {
  //   const editor = window.activeTextEditor!;
  const namePascal = pascalCase(name);
  //   const nameSnake = snakeCase(name);

  var newFields = [];

  for (let _field of fields) {
    var newFieldName = _field.trim();
    var ty = "String";

    let s = _field.split(':');

    if (s.length === 1) {
      s.push('z');
    }
    newFieldName = s[0];

    switch (s[1]) {
      case 'id': {
        ty = "ID";
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
        ty = "NaiveDateTime";
        break;
      }
      case 'i':
      case 'i32': {
        ty = "i32";
        break;
      }
      case 'i64': {
        ty = "i64";
        break;
      }
      case 'd': {
        ty = "f64";
        break;
      }
      case 'z[]': {
        ty = "Vec<String>";
        break;
      }
      case 'i[]':
      case 'i32[]': {
        ty = "Vec<i32>";
        break;
      }
      case 'i[]':
      case 'i64[]': {
        ty = "Vec<i64>";
        break;
      }
    }

    console.log("newFieldName: " + newFieldName);

    const newFieldNameSnake = snakeCase(newFieldName);

    newFields.push([newFieldNameSnake, ty]);
  }

  var newLines = [];
  newLines.push(`
#[doc(hidden)]
#[derive(Queryable, Serialize)]
pub struct ${namePascal} {
    `.trim());

  for (let fld of newFields) {
    newLines.push(`    pub ${fld[0]}: ${fld[1]},`);
  }
  newLines.push('}');

  return newLines.join('\n');
}
