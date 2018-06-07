import { Injectable } from "@angular/core";
import { HttpClient } from "@angular/common/http";
import { environment } from "../../environments/environment";

@Injectable({
  providedIn: "root"
})
export class SettingService {
  constructor(private _httpClient: HttpClient) {}

  getSettings() {
    return this._httpClient.get(environment.apiUrl + "/settings/LAUNCH_AT_STARTUP");
  }

  updateSettings(name, value) {
    return this._httpClient.put(environment.apiUrl + "/settings/" + name, {
      value: value
    });
  }

  startupSettings(value) {
    return this._httpClient.put(environment.apiUrl + "/settings/startup-launch" , {
      value: value
    });
  }
}