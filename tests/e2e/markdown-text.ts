/** Test-only text decoding; one replace pass, with no DOM/HTML interpretation. */
export function decodeNumericReferencesOnce(text:string):string {
  return text.replace(/&#(x[0-9a-f]+|[0-9]+);/gi,(reference:string,digits:string)=>{
    const point=digits[0].toLowerCase()==='x'?Number.parseInt(digits.slice(1),16):Number(digits);
    return Number.isSafeInteger(point)&&point>=0&&point<=0x10ffff&&!(point>=0xd800&&point<=0xdfff)
      ?String.fromCodePoint(point):reference;
  });
}
