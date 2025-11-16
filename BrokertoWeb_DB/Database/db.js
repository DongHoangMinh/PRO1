import { Sequelize } from "sequelize";
export const sequelize= new Sequelize("iotdb","postgres","minhtinh",{
  host:"localhost",
  dialect:"postgres",
  logging:false,

});
export async function connectDB() {
  try {
    await sequelize.authenticate();
    console.log("Postgres Connected");
  }
  catch(err){
    console.error("ConnectPG Error:",err.message);
  }
  
}