interface Bucket {tokens:number;at:number}
export class RateLimiter {
  private buckets=new Map<string,Bucket>();
  constructor(private now=Date.now,private max=10000){}
  allow(key:string,capacity:number):boolean {
    const now=this.now();for(const [k,b]of this.buckets)if(now-b.at>=3600000)this.buckets.delete(k);
    let b=this.buckets.get(key);if(!b){if(this.buckets.size>=this.max)return false;b={tokens:capacity,at:now};this.buckets.set(key,b);}
    b.tokens=Math.min(capacity,b.tokens+(now-b.at)*capacity/3600000);b.at=now;
    if(b.tokens<1)return false;b.tokens--;return true;
  }
}
