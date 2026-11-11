/**
 * Structured outputs for cloud providers. Without a constrained shape, replies that must be JSON (test cases, blind answers)
 * sometimes came back unusable; Ollama fixed that locally (types 11/18 -> 16/18). Each cloud API takes the schema differently:
 *   Anthropic  output_config.format = {type:"json_schema", schema}   (every object needs additionalProperties:false)
 *   OpenAI     text.format = {type:"json_schema", name, schema, strict:true}   (same rule, and every property required)
 *   Gemini     generationConfig.responseMimeType + responseJsonSchema
 * LAYANX_CLOUD_STRUCTURED=off sends no schema. A provider that rejects the schema (HTTP 400) is asked again without it.
 */
export const structuredOn=(env:NodeJS.ProcessEnv=process.env)=>env.LAYANX_CLOUD_STRUCTURED!=="off";

/** Adds additionalProperties:false to every object and lists every property as required, as strict modes demand. */
export function strictSchema(schema:unknown):unknown{
  if(Array.isArray(schema))return schema.map(strictSchema);
  if(!schema||typeof schema!=="object")return schema;
  const out:Record<string,unknown>={};
  for(const[key,value]of Object.entries(schema as Record<string,unknown>))out[key]=key==="properties"&&value&&typeof value==="object"
    ?Object.fromEntries(Object.entries(value as Record<string,unknown>).map(([name,inner])=>[name,strictSchema(inner)]))
    :strictSchema(value);
  if(out.type==="object"){
    out.additionalProperties=false;
    if(out.properties&&typeof out.properties==="object")out.required=Object.keys(out.properties as object);
  }
  return out;
}

/** Room for the reply after the model's own thinking, which these APIs count against the same limit. */
export const cloudOutputTokens=(requested?:number)=>Math.max(requested??0,16000);
