import http from "node:http";

/**
 * A stand-in for a WooCommerce store's REST API (wp-json/wc/v3), close to the real one where LayanX depends on it:
 * Basic auth with consumer key/secret (401 woocommerce_rest_cannot_view otherwise), 100 items per page at most with
 * X-WP-Total / X-WP-TotalPages, after + dates_are_gmt filtering on date_created_gmt (no "Z"), ?sku=, PUT that changes the
 * record, read-only keys refused with 401 woocommerce_rest_cannot_edit, and rest_no_route for unknown paths.
 */
export interface FakeStore{url:string;products:any[];orders:any[];requests:Array<{method:string;path:string;body?:any}>;close():Promise<void>}
const gmt=(d:Date)=>d.toISOString().slice(0,19);

export function sampleCatalog(now=new Date()){
  const today=(h:number)=>{const d=new Date(now);d.setHours(h,0,0,0);return gmt(d);};
  const daysAgo=(n:number)=>{const d=new Date(now);d.setDate(d.getDate()-n);d.setHours(12,0,0,0);return gmt(d);};
  // 230 products, so the list really needs three pages.
  const products:any[]=[
    {id:11,name:"عسل سدر يمني 500 جرام",sku:"HONEY-500",status:"publish",price:"45",regular_price:"45",sale_price:"",stock_status:"instock",stock_quantity:12,manage_stock:true},
    {id:12,name:"بن يمني حراز 250 جرام",sku:"COFFEE-250",status:"publish",price:"30",regular_price:"30",sale_price:"",stock_status:"outofstock",stock_quantity:0,manage_stock:true},
    {id:13,name:"زيت سمسم بلدي",sku:"SESAME-1L",status:"publish",price:"18",regular_price:"18",sale_price:"",stock_status:"instock",stock_quantity:2,manage_stock:true},
    {id:14,name:"بخور عدني",sku:"BAKHOOR",status:"draft",price:"25",regular_price:"25",sale_price:"",stock_status:"outofstock",stock_quantity:0,manage_stock:true}
  ];
  for(let i=0;i<226;i++)products.push({id:100+i,name:"منتج تجريبي "+(i+1),sku:"FILL-"+i,status:"publish",price:"10",regular_price:"10",sale_price:"",stock_status:"instock",stock_quantity:50,manage_stock:true});
  const li=(product_id:number,name:string,quantity:number,price:number)=>({product_id,name,quantity,total:String(quantity*price)});
  const orders=[
    {id:501,number:"1041",status:"processing",total:"90.00",currency:"SAR",date_created_gmt:today(1),line_items:[li(11,"عسل سدر يمني 500 جرام",2,45)],shipping:{city:"الرياض"},billing:{first_name:"سالم",city:"الرياض"}},
    {id:502,number:"1042",status:"completed",total:"30.00",currency:"SAR",date_created_gmt:today(2),line_items:[li(12,"بن يمني حراز 250 جرام",1,30)],shipping:{city:"جدة"}},
    {id:503,number:"1043",status:"pending",total:"45.00",currency:"SAR",date_created_gmt:today(3),line_items:[li(11,"عسل سدر يمني 500 جرام",1,45)]},
    {id:504,number:"1044",status:"cancelled",total:"18.00",currency:"SAR",date_created_gmt:today(4),line_items:[li(13,"زيت سمسم بلدي",1,18)]},
    {id:505,number:"1045",status:"processing",total:"63.00",currency:"SAR",date_created_gmt:today(5),line_items:[li(11,"عسل سدر يمني 500 جرام",1,45),li(13,"زيت سمسم بلدي",1,18)],billing:{city:"الدمام"}},
    {id:490,number:"1030",status:"completed",total:"300.00",currency:"SAR",date_created_gmt:daysAgo(3),line_items:[li(12,"بن يمني حراز 250 جرام",10,30)]},
    {id:470,number:"1010",status:"completed",total:"450.00",currency:"SAR",date_created_gmt:daysAgo(20),line_items:[li(11,"عسل سدر يمني 500 جرام",10,45)]}
  ];
  return{products,orders};
}

export async function startFakeWoo(opts:{key?:string;secret?:string;readOnly?:boolean;now?:Date;prefix?:string}={}):Promise<FakeStore>{
  const key=opts.key??"ck_test",secret=opts.secret??"cs_test",prefix=opts.prefix??"/wp-json/wc/v3";
  const {products,orders}=sampleCatalog(opts.now);
  const requests:FakeStore["requests"]=[];
  const server=http.createServer(async(req,res)=>{
    let raw="";for await(const c of req)raw+=c;
    const u=new URL(req.url??"/","http://x");
    const send=(status:number,data:unknown,headers:Record<string,string>={})=>{res.writeHead(status,{"content-type":"application/json; charset=UTF-8",...headers});res.end(JSON.stringify(data));};
    const body=raw?JSON.parse(raw):undefined;
    requests.push({method:req.method??"GET",path:u.pathname+u.search,...(body?{body}:{})});
    if(!u.pathname.startsWith(prefix))return send(404,{code:"rest_no_route",message:"No route was found matching the URL and request method.",data:{status:404}});
    const expected="Basic "+Buffer.from(key+":"+secret).toString("base64");
    if(req.headers.authorization!==expected)return send(401,{code:"woocommerce_rest_cannot_view",message:"Sorry, you cannot list resources.",data:{status:401}});
    const path=u.pathname.slice(prefix.length).replace(/^\//,"").split("/");
    const list=(items:any[])=>{
      const per=Math.min(100,Number(u.searchParams.get("per_page")??10)),page=Number(u.searchParams.get("page")??1);
      return send(200,items.slice((page-1)*per,page*per),{"x-wp-total":String(items.length),"x-wp-totalpages":String(Math.max(1,Math.ceil(items.length/per)))});
    };
    const collection=path[0]==="products"?products:path[0]==="orders"?orders:null;
    if(!collection)return send(404,{code:"rest_no_route",message:"No route",data:{status:404}});
    if(req.method==="GET"&&path.length===1){
      let items=collection;
      if(path[0]==="products"){
        const status=u.searchParams.get("status");if(status&&status!=="any")items=items.filter(p=>p.status===status);else if(!status)items=items.filter(p=>p.status==="publish");
        const sku=u.searchParams.get("sku");if(sku)items=items.filter(p=>p.sku===sku);
      }else{
        const after=u.searchParams.get("after");
        if(after){if(u.searchParams.get("dates_are_gmt")!=="true")return send(400,{code:"test_wants_gmt",message:"this fake store only filters GMT dates"});const t=Date.parse(after);items=items.filter(o=>Date.parse(o.date_created_gmt+"Z")>t);}
        const status=u.searchParams.get("status");if(status&&status!=="any")items=items.filter(o=>o.status===status);
      }
      return list(items);
    }
    const item=collection.find(x=>String(x.id)===path[1]);
    if(req.method==="GET"&&item)return send(200,item);
    if(req.method==="PUT"&&item){
      if(opts.readOnly)return send(401,{code:"woocommerce_rest_cannot_edit",message:"Sorry, you are not allowed to edit this resource.",data:{status:401}});
      Object.assign(item,body);
      if(path[0]==="products"){
        if("regular_price" in body||"sale_price" in body)item.price=item.sale_price||item.regular_price;
        if("stock_quantity" in body)item.stock_status=Number(item.stock_quantity)>0?"instock":"outofstock";
      }
      return send(200,item);
    }
    if(req.method==="POST"&&path.length===1&&path[0]==="products"){
      if(opts.readOnly)return send(401,{code:"woocommerce_rest_cannot_create",message:"no",data:{status:401}});
      const made={id:900+products.length,status:"publish",sale_price:"",stock_status:"instock",stock_quantity:null,manage_stock:false,...body};made.price=made.regular_price;products.push(made);return send(201,made);
    }
    return send(404,{code:"woocommerce_rest_invalid_id",message:"Invalid ID.",data:{status:404}});
  });
  await new Promise<void>(r=>server.listen(0,"127.0.0.1",()=>r()));
  return{url:"http://127.0.0.1:"+(server.address() as {port:number}).port,products,orders,requests,close:()=>new Promise(r=>server.close(()=>r()))};
}
