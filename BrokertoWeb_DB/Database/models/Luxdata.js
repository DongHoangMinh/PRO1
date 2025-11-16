import { DataTypes } from "sequelize";
import { sequelize } from "../db.js";
export const Luxdata = sequelize.define("Luxdata", {
  lux: {
    type: DataTypes.FLOAT,
    allowNull: false,
  },
  timestamp: {
    type: DataTypes.DATE,
    allowNull: false,
    unique: true,
  }
})