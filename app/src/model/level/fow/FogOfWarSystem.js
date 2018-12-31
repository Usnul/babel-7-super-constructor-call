import { System } from "../../engine/ecs/System.js";
import Terrain from "../terrain/ecs/Terrain.js";


export class FogOfWarSystem extends System {
    constructor() {
        super();
        this.dependencies.push(Terrain);
    }
}