export function roundDecimal(value:number,decimals=12):number{
 if(!Number.isFinite(value))return value;
 const factor=10**decimals;
 return Math.round((value+Number.EPSILON)*factor)/factor;
}
