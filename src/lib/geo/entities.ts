export type EntityType='brand'|'printer'|'oem'|'product'|'category';
export interface Entity{id:string;type:EntityType;slug:string;name:string;}
