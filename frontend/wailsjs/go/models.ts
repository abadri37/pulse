export namespace engine {
	
	export class CookieItem {
	    name: string;
	    value: string;
	    domain: string;
	    path: string;
	    secure: boolean;
	    httpOnly: boolean;
	
	    static createFrom(source: any = {}) {
	        return new CookieItem(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.name = source["name"];
	        this.value = source["value"];
	        this.domain = source["domain"];
	        this.path = source["path"];
	        this.secure = source["secure"];
	        this.httpOnly = source["httpOnly"];
	    }
	}
	export class RequestBody {
	    type: string;
	    raw: string;
	
	    static createFrom(source: any = {}) {
	        return new RequestBody(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.type = source["type"];
	        this.raw = source["raw"];
	    }
	}
	export class ParamPair {
	    key: string;
	    value: string;
	    enabled: boolean;
	
	    static createFrom(source: any = {}) {
	        return new ParamPair(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.key = source["key"];
	        this.value = source["value"];
	        this.enabled = source["enabled"];
	    }
	}
	export class HeaderPair {
	    key: string;
	    value: string;
	    enabled: boolean;
	
	    static createFrom(source: any = {}) {
	        return new HeaderPair(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.key = source["key"];
	        this.value = source["value"];
	        this.enabled = source["enabled"];
	    }
	}
	export class HTTPRequest {
	    id: string;
	    name: string;
	    method: string;
	    url: string;
	    headers: HeaderPair[];
	    queryParams: ParamPair[];
	    body: RequestBody;
	    variables: Record<string, string>;
	    timeoutMs: number;
	    insecureSkipVerify: boolean;
	    preRequestScript: string;
	    postResponseScript: string;
	
	    static createFrom(source: any = {}) {
	        return new HTTPRequest(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.id = source["id"];
	        this.name = source["name"];
	        this.method = source["method"];
	        this.url = source["url"];
	        this.headers = this.convertValues(source["headers"], HeaderPair);
	        this.queryParams = this.convertValues(source["queryParams"], ParamPair);
	        this.body = this.convertValues(source["body"], RequestBody);
	        this.variables = source["variables"];
	        this.timeoutMs = source["timeoutMs"];
	        this.insecureSkipVerify = source["insecureSkipVerify"];
	        this.preRequestScript = source["preRequestScript"];
	        this.postResponseScript = source["postResponseScript"];
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}
	export class TestResult {
	    name: string;
	    passed: boolean;
	    error?: string;
	
	    static createFrom(source: any = {}) {
	        return new TestResult(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.name = source["name"];
	        this.passed = source["passed"];
	        this.error = source["error"];
	    }
	}
	export class TimingStats {
	    dnsDurationMs: number;
	    tcpDurationMs: number;
	    tlsDurationMs: number;
	    ttfbDurationMs: number;
	    downloadDurationMs: number;
	    totalDurationMs: number;
	
	    static createFrom(source: any = {}) {
	        return new TimingStats(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.dnsDurationMs = source["dnsDurationMs"];
	        this.tcpDurationMs = source["tcpDurationMs"];
	        this.tlsDurationMs = source["tlsDurationMs"];
	        this.ttfbDurationMs = source["ttfbDurationMs"];
	        this.downloadDurationMs = source["downloadDurationMs"];
	        this.totalDurationMs = source["totalDurationMs"];
	    }
	}
	export class HTTPResponse {
	    statusCode: number;
	    statusText: string;
	    headers: Record<string, Array<string>>;
	    body: string;
	    size: number;
	    timing: TimingStats;
	    cookies: CookieItem[];
	    testResults: TestResult[];
	    updatedVariables?: Record<string, string>;
	    error?: string;
	
	    static createFrom(source: any = {}) {
	        return new HTTPResponse(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.statusCode = source["statusCode"];
	        this.statusText = source["statusText"];
	        this.headers = source["headers"];
	        this.body = source["body"];
	        this.size = source["size"];
	        this.timing = this.convertValues(source["timing"], TimingStats);
	        this.cookies = this.convertValues(source["cookies"], CookieItem);
	        this.testResults = this.convertValues(source["testResults"], TestResult);
	        this.updatedVariables = source["updatedVariables"];
	        this.error = source["error"];
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}
	
	
	
	

}

export namespace loadtest {
	
	export class LoadTestConfig {
	    targetRequest: engine.HTTPRequest;
	    virtualUsers: number;
	    durationSeconds: number;
	    rampUpSeconds: number;
	
	    static createFrom(source: any = {}) {
	        return new LoadTestConfig(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.targetRequest = this.convertValues(source["targetRequest"], engine.HTTPRequest);
	        this.virtualUsers = source["virtualUsers"];
	        this.durationSeconds = source["durationSeconds"];
	        this.rampUpSeconds = source["rampUpSeconds"];
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}
	export class SummaryReport {
	    totalRequests: number;
	    successfulRequests: number;
	    failedRequests: number;
	    totalDurationSec: number;
	    throughputRps: number;
	    minLatencyMs: number;
	    maxLatencyMs: number;
	    avgLatencyMs: number;
	    p50LatencyMs: number;
	    p90LatencyMs: number;
	    p95LatencyMs: number;
	    p99LatencyMs: number;
	    statusDistribution: Record<number, number>;
	    totalDataBytes: number;
	    targetUrl: string;
	    targetMethod: string;
	    virtualUsers: number;
	
	    static createFrom(source: any = {}) {
	        return new SummaryReport(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.totalRequests = source["totalRequests"];
	        this.successfulRequests = source["successfulRequests"];
	        this.failedRequests = source["failedRequests"];
	        this.totalDurationSec = source["totalDurationSec"];
	        this.throughputRps = source["throughputRps"];
	        this.minLatencyMs = source["minLatencyMs"];
	        this.maxLatencyMs = source["maxLatencyMs"];
	        this.avgLatencyMs = source["avgLatencyMs"];
	        this.p50LatencyMs = source["p50LatencyMs"];
	        this.p90LatencyMs = source["p90LatencyMs"];
	        this.p95LatencyMs = source["p95LatencyMs"];
	        this.p99LatencyMs = source["p99LatencyMs"];
	        this.statusDistribution = source["statusDistribution"];
	        this.totalDataBytes = source["totalDataBytes"];
	        this.targetUrl = source["targetUrl"];
	        this.targetMethod = source["targetMethod"];
	        this.virtualUsers = source["virtualUsers"];
	    }
	}

}

export namespace storage {
	
	export class SavedRequest {
	    id: string;
	    name: string;
	    collection: string;
	    method: string;
	    url: string;
	    headers: engine.HeaderPair[];
	    queryParams: engine.ParamPair[];
	    body: engine.RequestBody;
	    preRequestScript?: string;
	    postResponseScript?: string;
	    lastModifiedAt: number;
	
	    static createFrom(source: any = {}) {
	        return new SavedRequest(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.id = source["id"];
	        this.name = source["name"];
	        this.collection = source["collection"];
	        this.method = source["method"];
	        this.url = source["url"];
	        this.headers = this.convertValues(source["headers"], engine.HeaderPair);
	        this.queryParams = this.convertValues(source["queryParams"], engine.ParamPair);
	        this.body = this.convertValues(source["body"], engine.RequestBody);
	        this.preRequestScript = source["preRequestScript"];
	        this.postResponseScript = source["postResponseScript"];
	        this.lastModifiedAt = source["lastModifiedAt"];
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}
	export class Collection {
	    id: string;
	    name: string;
	    path: string;
	    requests: SavedRequest[];
	    folders?: Collection[];
	
	    static createFrom(source: any = {}) {
	        return new Collection(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.id = source["id"];
	        this.name = source["name"];
	        this.path = source["path"];
	        this.requests = this.convertValues(source["requests"], SavedRequest);
	        this.folders = this.convertValues(source["folders"], Collection);
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}
	export class SavedEnvironment {
	    id: string;
	    name: string;
	    variables: Record<string, string>;
	
	    static createFrom(source: any = {}) {
	        return new SavedEnvironment(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.id = source["id"];
	        this.name = source["name"];
	        this.variables = source["variables"];
	    }
	}
	
	export class WorkspaceData {
	    workspacePath: string;
	    collections: Collection[];
	    environments: SavedEnvironment[];
	
	    static createFrom(source: any = {}) {
	        return new WorkspaceData(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.workspacePath = source["workspacePath"];
	        this.collections = this.convertValues(source["collections"], Collection);
	        this.environments = this.convertValues(source["environments"], SavedEnvironment);
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}

}

