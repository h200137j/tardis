export namespace main {
	
	export class LocalConfig {
	    mysql_bin: string;
	    db_name: string;
	    db_user: string;
	    db_pass: string;
	
	    static createFrom(source: any = {}) {
	        return new LocalConfig(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.mysql_bin = source["mysql_bin"];
	        this.db_name = source["db_name"];
	        this.db_user = source["db_user"];
	        this.db_pass = source["db_pass"];
	    }
	}
	export class ServerConfig {
	    server_ip: string;
	    ssh_user: string;
	    ssh_password: string;
	    private_key_path: string;
	    db_name: string;
	    db_user: string;
	    db_password: string;
	
	    static createFrom(source: any = {}) {
	        return new ServerConfig(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.server_ip = source["server_ip"];
	        this.ssh_user = source["ssh_user"];
	        this.ssh_password = source["ssh_password"];
	        this.private_key_path = source["private_key_path"];
	        this.db_name = source["db_name"];
	        this.db_user = source["db_user"];
	        this.db_password = source["db_password"];
	    }
	}
	export class Config {
	    production: ServerConfig;
	    test: ServerConfig;
	    local: LocalConfig;
	
	    static createFrom(source: any = {}) {
	        return new Config(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.production = this.convertValues(source["production"], ServerConfig);
	        this.test = this.convertValues(source["test"], ServerConfig);
	        this.local = this.convertValues(source["local"], LocalConfig);
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
	
	
	export class UpdateInfo {
	    has_update: boolean;
	    latest: string;
	    current: string;
	    download_url: string;
	
	    static createFrom(source: any = {}) {
	        return new UpdateInfo(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.has_update = source["has_update"];
	        this.latest = source["latest"];
	        this.current = source["current"];
	        this.download_url = source["download_url"];
	    }
	}

}

