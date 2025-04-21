#rm *.go ; protoc --proto_path=/usr/local/include/ -I=. --go_out=paths=source_relative:. *.proto
#rm ../public/*_pb.js ;  protoc -I=.  --es_out ../public --es_opt import_extension=js --es_opt target=js *.proto

rm *.go ; protoc -I=. --go_out=paths=source_relative:. *.proto
rm ../public/*_pb.js ;  protoc -I=.  --es_out ../public --es_opt import_extension=js --es_opt target=js *.proto

